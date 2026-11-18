// fal's own description of each endpoint (its OpenAPI schema), read before anything is sent: the request is built from
// the fields fal lists, never from a guess. The endpoint IDs and inputs could not be read from the cloud session where
// this spike was written (fal.ai was out of reach), so each method lists candidate IDs and the fields are matched by
// their role (the clip, the character's picture(s), the prompt, the resolution...). `pnpm recast check` prints what was
// found. Pure parsing and matching (tested); the fetch is injected.

export type Field = { name: string; type: string; enum?: (string | number)[]; default?: unknown; minimum?: number; maximum?: number; isArray: boolean; required: boolean; description?: string };
export type EndpointSchema = { id: string; fields: Field[]; fetchedAt: string };

export const openapiUrl = (id: string) => `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(id)}`;

type Json = Record<string, unknown>;

function resolveRef(doc: Json, ref: string): Json {
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: unknown = doc;
  for (const p of parts) cur = (cur as Json)?.[p];
  return (cur ?? {}) as Json;
}

function deref(doc: Json, s: Json): Json {
  let cur = s;
  for (let i = 0; i < 5 && typeof cur.$ref === "string"; i++) cur = resolveRef(doc, cur.$ref);
  return cur;
}

// The input fields of the endpoint's POST request (the queue submit), from the OpenAPI document fal serves.
export function parseOpenApi(id: string, doc: Json): Field[] {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Json>>;
  const post = Object.entries(paths).find(([p, v]) => v.post && !/\/requests\//.test(p))?.[1]?.post;
  const content = ((post?.requestBody as Json)?.content ?? {}) as Record<string, Json>;
  const body = content["application/json"]?.schema as Json | undefined;
  if (!body) throw new Error(`fal's description of ${id} has no request body`);
  const schema = deref(doc, body);
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const props = (schema.properties ?? {}) as Record<string, Json>;
  return Object.entries(props).map(([name, raw]) => {
    let p = deref(doc, raw);
    // Optional fields come as anyOf [X, null]: use X.
    const alt = (p.anyOf ?? p.oneOf) as Json[] | undefined;
    if (alt) p = { ...deref(doc, alt.find((x) => (x as Json).type !== "null") ?? alt[0]), ...p, anyOf: undefined, oneOf: undefined };
    const items = p.items ? deref(doc, p.items as Json) : null;
    const isArray = p.type === "array";
    const en = (p.enum ?? items?.enum) as (string | number)[] | undefined;
    return {
      name,
      type: String((isArray ? items?.type : p.type) ?? (en ? typeof en[0] : "string")),
      ...(en ? { enum: en } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(typeof p.minimum === "number" ? { minimum: p.minimum } : {}),
      ...(typeof p.maximum === "number" ? { maximum: p.maximum } : {}),
      isArray,
      required: required.has(name),
      ...(typeof p.description === "string" ? { description: p.description.slice(0, 200) } : {}),
    };
  });
}

export async function fetchSchema(id: string, fetchImpl: typeof fetch = fetch): Promise<EndpointSchema | null> {
  const r = await fetchImpl(openapiUrl(id));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fal answered HTTP ${r.status} for ${id}'s description`);
  const doc = (await r.json()) as Json;
  if (!doc.paths) return null; // an unknown endpoint: fal answers with an error document
  return { id, fields: parseOpenApi(id, doc), fetchedAt: new Date().toISOString() };
}

// ---- matching the request to the fields fal lists ----

// What a method wants to send, by role. Each role is matched to the endpoint's field names below.
export type Wants = {
  video?: string; // the clip (or the motion reference video)
  images?: string[]; // pictures, best first (the character's, or the new first frame for an endpoint that takes it as a picture)
  elements?: { frontal: string; refs: string[] }[]; // characters as fal "elements" (Kling): frontal picture + more views
  extra?: Record<string, unknown>; // optional fields, each sent only if fal lists a field of that exact name
  firstFrame?: string; // the new first frame (an endpoint with a first-frame field)
  image?: string; // a single picture to process (depth map)
  prompt?: string;
  resolution?: string[]; // preferred values, first match wins (e.g. ["480p"] or ["768P", "720p"])
  durationS?: number;
  aspect?: number; // width / height of the clip
  fps?: number;
  seed?: number;
  imageSize?: { width: number; height: number }; // for an object-typed image_size
  imageSizeText?: string; // for a text-typed image_size ("1024x1536")
};

const ROLE_NAMES: Record<string, RegExp[]> = {
  video: [/^video_url$/, /^reference_video_urls?$/, /^video_urls?$/, /^(input|source|driving|motion)_video(_url)?$/, /video.*url|url.*video/],
  firstFrame: [/^(first_frame|start_frame|start_image|first_image)(_url)?$/, /^image_url$/],
  images: [/^(reference_)?image_urls$/, /^(character|reference|subject|face)_image_urls?$/, /^image_url$/, /^images?$/, /image.*url|url.*image/],
  image: [/^image_url$/, /^image$/, /image.*url|url.*image/],
  prompt: [/^prompt$/],
  resolution: [/^resolution$/, /^video_resolution$/, /resolution/],
  duration: [/^duration$/, /duration/],
  aspect: [/^aspect_ratio$/],
  seed: [/^seed$/],
  imageSize: [/^image_size$/],
  numFrames: [/^num_frames$/],
  fps: [/^frames_per_second$/, /^fps$/],
};

function find(fields: Field[], role: keyof typeof ROLE_NAMES, used: Set<string>): Field | undefined {
  for (const re of ROLE_NAMES[role]) {
    const f = fields.find((x) => !used.has(x.name) && re.test(x.name));
    if (f) return f;
  }
  return undefined;
}

const ratio = (s: string) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s);
  return m ? Number(m[1]) / Number(m[2]) : null;
};

export type Mapped = { input: Record<string, unknown>; notes: string[]; missing: string[] };

// Builds the request: each wanted role goes to the field fal lists for it; required fields the spike cannot fill are
// named in `missing` (then nothing is sent).
export function mapInput(schema: EndpointSchema, w: Wants): Mapped {
  const fields = schema.fields;
  const used = new Set<string>();
  const input: Record<string, unknown> = {};
  const notes: string[] = [];
  const put = (f: Field | undefined, v: unknown) => {
    if (!f || v === undefined) return false;
    input[f.name] = f.isArray && !Array.isArray(v) ? [v] : !f.isArray && Array.isArray(v) ? v[0] : v;
    used.add(f.name);
    return true;
  };
  if (w.video) put(find(fields, "video", used), w.video);
  if (w.firstFrame) put(find(fields, "firstFrame", used), w.firstFrame);
  if (w.images?.length) {
    const f = find(fields, "images", used);
    if (f && !f.isArray && w.images.length > 1) notes.push(`${schema.id} takes one picture (${f.name}): the first was sent.`);
    put(f, f?.isArray ? w.images : w.images[0]);
  }
  if (w.elements?.length) {
    const f = fields.find((x) => x.name === "elements" && !used.has("elements"));
    if (f) put(f, w.elements.map((e) => ({ frontal_image_url: e.frontal, reference_image_urls: e.refs })));
    else notes.push(`${schema.id} lists no field "elements": the character was not sent as an element.`);
  }
  if (w.image) put(find(fields, "image", used), w.image);
  if (w.prompt) put(find(fields, "prompt", used), w.prompt);
  if (w.seed !== undefined) put(find(fields, "seed", used), w.seed);
  const res = find(fields, "resolution", used);
  if (res && w.resolution?.length) {
    const opts = res.enum?.map(String) ?? [];
    const pick = w.resolution.find((r) => !opts.length || opts.some((o) => o.toLowerCase() === r.toLowerCase()));
    const exact = pick && opts.find((o) => o.toLowerCase() === pick.toLowerCase());
    if (exact ?? pick) put(res, exact ?? pick);
    else notes.push(`${res.name}: none of ${w.resolution.join(", ")} is offered (${opts.join(", ")}); fal's default is used.`);
  }
  const dur = find(fields, "duration", used);
  if (dur && w.durationS !== undefined) {
    if (dur.enum?.length) {
      const opts = dur.enum.map((x) => ({ raw: x, n: Number(String(x).replace(/s$/, "")) })).filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n);
      const pick = opts.find((x) => x.n >= w.durationS! - 0.05) ?? opts[opts.length - 1];
      if (pick) put(dur, pick.raw);
    } else {
      let n = Math.ceil(w.durationS - 0.05);
      if (dur.minimum !== undefined) n = Math.max(n, dur.minimum);
      if (dur.maximum !== undefined) n = Math.min(n, dur.maximum);
      put(dur, dur.type === "string" ? String(n) : n);
    }
  }
  const asp = find(fields, "aspect", used);
  if (asp && w.aspect && asp.enum?.length) {
    const opts = asp.enum.map(String).map((o) => ({ o, r: ratio(o) })).filter((x) => x.r !== null);
    if (opts.length) put(asp, opts.sort((a, b) => Math.abs(Math.log(a.r! / w.aspect!)) - Math.abs(Math.log(b.r! / w.aspect!)))[0].o);
  }
  const size = find(fields, "imageSize", used);
  if (size && w.imageSizeText && (size.type === "string" || size.enum)) put(size, w.imageSizeText);
  else if (size && w.imageSize && size.type !== "string") put(size, w.imageSize);
  const frames = find(fields, "numFrames", used);
  if (frames?.required && w.durationS !== undefined) {
    let n = Math.round(w.durationS * (w.fps ?? 16));
    if (frames.minimum !== undefined) n = Math.max(n, frames.minimum);
    if (frames.maximum !== undefined) n = Math.min(n, frames.maximum);
    put(frames, n);
  }
  for (const [k, v] of Object.entries(w.extra ?? {})) {
    const f = fields.find((x) => x.name === k && !used.has(k));
    if (f) put(f, v);
    else notes.push(`${schema.id} lists no field "${k}": not sent.`);
  }
  const missing = fields.filter((f) => f.required && !(f.name in input) && f.default === undefined).map((f) => f.name);
  return { input, notes, missing };
}

// The first URL of a video (or picture) anywhere in fal's answer.
export function findUrl(data: unknown, kind: "video" | "image"): string | null {
  const ext = kind === "video" ? /\.(mp4|webm|mov)(\?|$)/i : /\.(png|jpe?g|webp)(\?|$)/i;
  const preferred = kind === "video" ? ["video", "videos", "output"] : ["image", "images", "depth_map", "output"];
  const seen = new Set<unknown>();
  const walk = (v: unknown, keyHint: boolean): string | null => {
    if (v === null || v === undefined || seen.has(v)) return null;
    if (typeof v === "string") return /^https?:\/\//.test(v) && (keyHint || ext.test(v)) ? v : null;
    if (typeof v !== "object") return null;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = walk(x, keyHint);
        if (r) return r;
      }
      return null;
    }
    const o = v as Json;
    for (const k of preferred) if (k in o) {
      const r = walk(o[k], true);
      if (r) return r;
    }
    if (keyHint && typeof o.url === "string") return o.url;
    for (const x of Object.values(o)) {
      const r = walk(x, keyHint);
      if (r) return r;
    }
    return null;
  };
  return walk(data, false);
}
