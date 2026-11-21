// Pure logic of character and scene cards (no files, no network; first proven in spikes/characters): the views, the prompts, what each model is sent, what it costs,
// how a face score reads (green / amber / red) and when a view is made again. Tested in test/characters.test.ts.

// ---- what is generated ----

export type ViewId = "closeup" | "three_quarter" | "body_front" | "body_back";
export type AngleId = "wide_left" | "wide_right" | "detail";
export type Aspect = "3:4" | "2:3";

// Pack layout (decided 18 Nov 2026): the close-up is the identity source; faces come ONLY from the two face views.
// The full-body views are cropped at the neck, so no model invents a second, different face there. Face checks run
// on the face views only; a body view that shows a face anyway is made again.
// minFace: the face is at least this fraction of the picture's height (a face view is a close-up; Seedream once sent
// high-angle full-length shots). Null for the body views.
export type View = { id: ViewId; label: string; aspect: Aspect; face: boolean; expectYaw: [number, number] | null; minFace: number | null; prompt: string };
export const EYE_LEVEL = "Camera at eye level, level with their face: no high angle, no top-down view.";
export const VIEWS: View[] = [
  {
    id: "closeup",
    label: "Close-up face",
    aspect: "3:4",
    face: true,
    expectYaw: [0, 20],
    minFace: 0.35,
    prompt: "A close-up portrait of this person's face and the top of their shoulders, straight on, facing the camera and looking into the lens, relaxed neutral expression, mouth gently closed. Framing: head-and-shoulders portrait, the face filling about half the frame, camera at eye level, portrait lens (about 85 mm). Not a full-length shot, no high angle, no wide angle. Camera at eye level, level with their face: no high angle, no top-down view. Natural skin texture with pores and fine detail, no retouching. Eyebrows exactly as in the reference picture (same shape, thickness and colour), soft and natural with individual hairs, not drawn on, filled in or sharpened. Hair soft and natural with individual strands, no net, mesh, grid or lace-like pattern on the hair or skin. The same hairstyle as in the reference picture: the same length, parting, volume and direction; do not tie it back or restyle it, unless the outfit text below says otherwise.",
  },
  {
    id: "three_quarter",
    label: "3/4 face",
    aspect: "3:4",
    face: true,
    expectYaw: [20, 60],
    minFace: 0.3,
    prompt: "A head-and-shoulders portrait in a three-quarter view: this person's face turned about 45 degrees toward the camera, both eyes visible, not viewed from behind, eyes following the turn, relaxed neutral expression. Framing: head and shoulders, the face filling a large part of the picture, camera at eye level, portrait lens (about 85 mm). Not a full-length shot, no high angle, no wide angle. Camera at eye level, level with their face: no high angle, no top-down view. Natural skin texture, no retouching. Eyebrows exactly as in the reference picture (same shape, thickness and colour), soft and natural with individual hairs, not drawn on, filled in or sharpened. Hair soft and natural with individual strands, no net, mesh, grid or lace-like pattern on the hair or skin. The same hairstyle as in the reference picture: the same length, parting, volume and direction; do not tie it back or restyle it, unless the outfit text below says otherwise.",
  },
  {
    id: "body_front",
    label: "Full body, front (cropped at the neck)",
    aspect: "2:3",
    face: false,
    expectYaw: null,
    minFace: null,
    prompt: "A full-length photograph of this person's body from the front, standing naturally, arms relaxed, the whole outfit and shoes visible, camera at eye level (no high angle, no top-down view). The frame is CROPPED AT THE NECK: the top edge of the picture cuts just below the chin, so the face and head are completely out of frame.",
  },
  {
    id: "body_back",
    label: "Full body, back (cropped at the neck)",
    aspect: "2:3",
    face: false,
    expectYaw: null,
    minFace: null,
    prompt: "A full-length photograph of this person's body seen from behind, standing naturally, camera at eye level (no high angle, no top-down view), the back of the outfit (and veil, train or hair falling on the back) fully visible down to the shoes. The frame is CROPPED AT THE NECK: the top edge of the picture cuts at the nape, so the head is out of frame. Anything pinned or worn on the front only (a boutonnière, brooch, corsage, front buttons) is not visible from behind: do not show it at the shoulder or anywhere on the back.",
  },
];

// Setting (decided 18 Nov 2026): a neutral, empty outdoor place in soft daylight. Grey studio backdrops gave plastic skin.
export const PACK_STYLE =
  "Use the reference picture as BOTH the identity and the style reference: the same person (the same face, features, skin tone, hair and makeup), the same outfit, and the same visual style, colour grading, lens look and rendering as the reference. Do not change their identity, age or ethnicity. Setting: a neutral, empty outdoor place (an open field or a quiet garden path, softly out of focus behind them) in soft natural daylight, slightly overcast, gentle shadows. Not a studio, no backdrop, no text, no other people.";

export const ANGLES: { id: AngleId; label: string; prompt: string }[] = [
  { id: "wide_left", label: "Wide, from the left", prompt: "A wide view of this same place seen from the left side of the room, showing more of it." },
  // The first test showed this angle staying close to the original framing in every model: the prompt is now explicit.
  { id: "wide_right", label: "Wide, from the right", prompt: "A wide view of this same place with the camera moved to the OPPOSITE side of the room, looking back across it toward the main feature: a clearly different viewpoint from the reference, showing the parts of the room the reference does not show." },
  { id: "detail", label: "Closer detail", prompt: "A closer view of the main feature of this place (for example the mirror or the window), as a detail shot." },
];

export const SCENE_STYLE =
  "Use the reference picture as BOTH the location and the style reference: the same room with the same architecture, furniture, colours, materials and light, and the same visual style, colour grading and rendering. Only the camera position changes. Keep it empty: no people. No text.";

// The outfit comes from Paul (--outfit): the reference often shows only the shoulders, and each model invented a
// different outfit below them (Seedream: a trouser suit). Without it, the prompt asks to continue the reference's.
// The outfit in three parts (what a head-and-shoulders frame, the front and the back show), made from Paul's one text.
export type OutfitSplit = { from: string; closeups: string; front: string; back: string };
export const splitIsCurrent = (s: OutfitSplit | undefined | null, outfit: string | undefined): s is OutfitSplit => !!s && !!outfit?.trim() && s.from.trim() === outfit.trim();

// ---- per-view details: what is only on one side, the neckline, the veil ----

// Details that sit on one side of the outfit only; each gets a short negative on the other side (front: "No buttons on the front.").
type SideDetail = { re: RegExp; backNo: string; frontNo: string };
const SIDE_DETAILS: SideDetail[] = [
  { re: /\bbuttons?\b/i, backNo: "buttons", frontNo: "buttons" },
  { re: /\bbows?\b/i, backNo: "bow", frontNo: "bow" },
  { re: /\b(lacing|lace[- ]up|corset)\b/i, backNo: "lacing or corset ties", frontNo: "lacing or corset ties" },
  { re: /\bzip(per)?s?\b/i, backNo: "zipper", frontNo: "zipper" },
  { re: /\bcut[- ]?outs?\b/i, backNo: "cut-out", frontNo: "cut-out" },
  { re: /\bkeyhole\b/i, backNo: "keyhole opening", frontNo: "keyhole opening" },
  { re: /\bopen[- ]back\b/i, backNo: "open-back cut", frontNo: "open-back cut" },
  { re: /\bV[- ]back\b/i, backNo: "V-shaped back cut", frontNo: "V-shaped back cut" },
  { re: /\btrain\b/i, backNo: "train", frontNo: "train" },
];
const FRONT_ONLY: { re: RegExp; no: string }[] = [
  { re: /\bboutonni[eè]re\b/i, no: "boutonnière" },
  { re: /\bbrooch(es)?\b/i, no: "brooch" },
  { re: /\bcorsage\b/i, no: "corsage" },
  { re: /\bbuttons?\b/i, no: "buttons" },
];

// Explicit negatives for the front view: details found in the back text but not in the front text.
export function frontNegatives(front: string, back: string): string[] {
  return SIDE_DETAILS.filter((d) => d.re.test(back) && !d.re.test(front)).map((d) => `No ${d.frontNo} on the front.`);
}
// Explicit negatives for the back view: details found in the front text but not in the back text.
export function backNegatives(front: string, back: string): string[] {
  return FRONT_ONLY.filter((d) => d.re.test(front) && !d.re.test(back)).map((d) => `No ${d.no} on the back.`);
}

const NECKLINES: { re: RegExp; name: string }[] = [
  { re: /\b(bateau|boat[- ]?neck(line)?)\b/i, name: "bateau" },
  { re: /\bsweetheart\b/i, name: "sweetheart" },
  { re: /\bv[- ]?neck(line)?\b/i, name: "V-neck" },
  { re: /\boff[- ]the[- ]shoulders?\b/i, name: "off-the-shoulder" },
  { re: /\bone[- ]shoulder\b/i, name: "one-shoulder" },
  { re: /\bhalter\b/i, name: "halter" },
  { re: /\b(high[- ]neck(line)?|turtle[- ]?neck|mock[- ]neck)\b/i, name: "high" },
  { re: /\bcowl\b/i, name: "cowl" },
  { re: /\billusion\b/i, name: "illusion" },
  { re: /\bsquare[- ](neck(line)?|cut)\b/i, name: "square" },
  { re: /\b(scoop(ed)?)\b/i, name: "scoop" },
  { re: /\b(jewel)\b/i, name: "jewel" },
  { re: /\b(crew[- ]?neck|round[- ]neck(line)?|round neckline)\b/i, name: "round" },
];
const OTHER_NECKLINES = ["sweetheart", "V-neck", "round", "square", "off-the-shoulder"];

// The neckline named in a text (the earliest one), or null.
export function necklineOf(text: string): string | null {
  let best: { i: number; name: string } | null = null;
  for (const n of NECKLINES) {
    const m = n.re.exec(text);
    if (m && (!best || m.index < best.i)) best = { i: m.index, name: n.name };
  }
  return best?.name ?? null;
}
export function necklineSentence(closeups: string): string | null {
  const name = necklineOf(closeups);
  if (!name) return null;
  const others = OTHER_NECKLINES.filter((x) => x !== name);
  const list = `${others.slice(0, -1).join(", ")} or ${others[others.length - 1]}`;
  return `Neckline: ${name} neckline, exactly as in the close-ups; not ${list}.`;
}

// The clause of the outfit text that names the veil (e.g. "sheer ivory tulle veil"), or "the veil" when it cannot be taken out cleanly.
// Returns null when no veil is mentioned.
// A part of the outfit text without its veil clauses ("" when nothing else is left).
export function withoutVeil(text: string): string {
  return text
    .split(/\s*[,;]\s*/)
    .filter((c) => c.trim() && !/\bveil/i.test(c))
    .join(", ")
    .trim();
}

export function veilPhrase(...texts: (string | undefined | null)[]): string | null {
  let mentioned = false;
  for (const t of texts) {
    if (!t || !/\bveils?\b/i.test(t)) continue;
    mentioned = true;
    for (const clause of t.split(/\s*(?:[,;.]|\band\b|\bwith\b|\bplus\b)\s*/i)) {
      if (!/\bveil\b/i.test(clause)) continue;
      const c = clause.replace(/^\s*(?:(?:wearing|finished|topped|and|a|an|the|their|her|his)\s+)+/i, "").replace(/[.\s]+$/, "").trim();
      if (c && !/^veils?$/i.test(c) && c.split(/\s+/).length <= 8) return c;
    }
  }
  return mentioned ? "the veil" : null;
}
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function veilSentence(viewId: ViewId, phrase: string | null): string | null {
  if (!phrase) return null;
  const p = cap1(phrase);
  if (viewId === "body_front") return `${p} falling behind their shoulders, visible at both sides of the shoulders and arms.`;
  if (viewId === "body_back") return `${p} falling down their back, clearly visible.`;
  return `${p} falling behind their shoulders, visible in this picture.`;
}

export function viewPrompt(v: View, outfit?: string, split?: OutfitSplit | null): string {
  const o = outfit?.trim();
  const sp = splitIsCurrent(split, outfit) ? split : null;
  const keep = "Keep exactly this outfit, the same in the front and back views.";
  const veil = veilSentence(v.id, veilPhrase(o, sp?.closeups, sp?.front, sp?.back));
  const frame = `The frame ends at the upper chest: do NOT show the waist, legs, skirt, trousers or shoes${veil ? " (the veil is allowed to show)" : ""}.`;
  const extra: string[] = [];
  let wear: string;
  if (sp) {
    if (v.face) wear = ` Outfit (only the part inside this head-and-shoulders frame: neckline, collar, shoulders, earrings, hair): ${sp.closeups.trim() || "as in the reference picture"}. ${frame}`;
    else if (v.id === "body_front") {
      {
        // The veil is seen from the front too (behind the shoulders): it is never listed as a back-only detail.
        const backOnly = withoutVeil(sp.back);
        wear = ` Outfit: ${sp.front.trim()}. ${keep}${backOnly ? ` Details that are only on the back (${backOnly}) must NOT appear on the front.` : ""}`;
      }
      extra.push(...frontNegatives(sp.front, sp.back));
      const nl = necklineSentence(sp.closeups);
      if (nl) extra.push(nl);
    } else {
      // Only the named front-only items (backNegatives) are hidden: the "front" text also holds the gown itself, which
      // is of course visible from behind (seen in Bride No 2's prompt, 18 Nov 2026).
      wear = ` Outfit: ${sp.back.trim()}. ${keep}`;
      extra.push(...backNegatives(sp.front, sp.back));
    }
  } else
    wear = o
      ? v.face
        ? ` Outfit (only the part inside this head-and-shoulders frame: neckline, collar, shoulders, earrings, hair): ${o}. ${frame}`
        : ` Outfit: ${o}. ${keep}`
      : v.face
        ? ""
        : " Outfit: continue the outfit of the reference naturally below the frame, in the same style; do not change it into something else.";
  if (veil) extra.push(veil);
  return `${v.prompt}${wear}${extra.length ? ` ${extra.join(" ")}` : ""} ${PACK_STYLE}`;
}

export type ViewSet = "all" | "face" | "body";
export function viewsFor(set: ViewSet): View[] {
  return VIEWS.filter((v) => set === "all" || (set === "face" ? v.face : !v.face));
}
// Key props (from Paul, e.g. "gilded floor mirror, velvet armchair"): small details drifted in the first test (the
// mirror's crest), so the props are named in every angle.
export function anglePrompt(a: (typeof ANGLES)[number], props?: string): string {
  const p = props?.trim();
  return `${a.prompt}${p ? ` Key props that must stay exactly as they are in the reference (same shape, colour and details): ${p}.` : ""} ${SCENE_STYLE}`;
}

// ---- the image models (fal endpoints, inputs and prices checked on fal.ai on 17 Nov 2026) ----

export type ModelId = "nano-pro" | "nano2" | "seedream" | "gpt" | "gemini";
export const MODEL_IDS: readonly ModelId[] = ["nano-pro", "nano2", "seedream", "gpt", "gemini"];
// Default after the first bride test (18 Nov 2026, Paul): Seedream 4.5 gave the closest face (0.74), kept the reference's
// look and is the cheapest. The others stay available with --models.
export const DEFAULT_MODELS: readonly ModelId[] = ["seedream"];

export type ImageModel = {
  id: ModelId;
  name: string;
  endpoint: string;
  perImageUsd: number; // the estimate per image, from fal's price
  priceNote: string;
  provider?: "fal" | "gemini"; // gemini: Google directly, on the user's own GEMINI_API_KEY (default fal)
  input(prompt: string, refs: string[], aspect: Aspect, seed: number): Record<string, unknown>;
};

const SEEDREAM_SIZE: Record<Aspect, { width: number; height: number }> = {
  "3:4": { width: 1920, height: 2560 }, // Seedream 4.5: at least 2560x1440 pixels in total
  "2:3": { width: 1920, height: 2880 },
};

export const MODELS: Record<ModelId, ImageModel> = {
  "nano-pro": {
    id: "nano-pro",
    name: "Nano Banana Pro",
    endpoint: "fal-ai/nano-banana-pro/edit",
    perImageUsd: 0.15,
    priceNote: "$0.15 per image (1K and 2K; 4K double)",
    input: (prompt, refs, aspect, seed) => ({ prompt, image_urls: refs, aspect_ratio: aspect, resolution: "2K", num_images: 1, output_format: "png", seed }),
  },
  nano2: {
    id: "nano2",
    name: "Nano Banana 2",
    endpoint: "fal-ai/nano-banana-2/edit",
    perImageUsd: 0.08,
    priceNote: "$0.08 per image at 1K (2K x1.5)",
    input: (prompt, refs, aspect, seed) => ({ prompt, image_urls: refs, aspect_ratio: aspect, resolution: "1K", num_images: 1, output_format: "png", seed }),
  },
  seedream: {
    id: "seedream",
    name: "Seedream 4.5",
    endpoint: "fal-ai/bytedance/seedream/v4.5/edit",
    perImageUsd: 0.04,
    priceNote: "$0.04 per image",
    input: (prompt, refs, aspect, seed) => ({ prompt, image_urls: refs, image_size: SEEDREAM_SIZE[aspect], num_images: 1, max_images: 1, seed }),
  },
  gpt: {
    id: "gpt",
    name: "GPT Image 1.5",
    endpoint: "fal-ai/gpt-image-1.5/edit",
    // $0.200 per 1024x1536 image at high quality + about $0.04 of input image tokens at high fidelity.
    perImageUsd: 0.24,
    priceNote: "about $0.24 per image (high quality 1024x1536 $0.20 + input image tokens)",
    input: (prompt, refs, _aspect, _seed) => ({ prompt, image_urls: refs, image_size: "1024x1536", quality: "high", input_fidelity: "high", num_images: 1, output_format: "png" }),
  },
  // Paul's own Gemini key (21 Nov 2026): Nano Banana Pro straight from Google, billed to his Google account. Google's
  // list price for a 1K / 2K picture is about $0.134 (an estimate here: his Google bill is the real figure).
  gemini: {
    id: "gemini",
    name: "Gemini · Nano Banana Pro (your key)",
    endpoint: `gemini/${process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3-pro-image"}`,
    perImageUsd: 0.14,
    priceNote: "about $0.14 per image at 2K, on your own Google bill",
    provider: "gemini",
    input: (prompt, refs, aspect, _seed) => ({ prompt, image_urls: refs, aspect_ratio: aspect, image_size: "2K" }),
  },
};

// The cheap text model (no picture): splits the outfit per view. About $0.01 a call.
export const TEXT_MODEL = { endpoint: "fal-ai/any-llm", model: "google/gemini-2.5-flash-lite", perCallUsd: 0.01 };
export const VISION = { endpoint: "fal-ai/any-llm/vision", model: "google/gemini-2.5-flash-lite", perCallUsd: 0.01 };

export const DESCRIPTION_PROMPT =
  "Describe the person in this picture for an image generator, so the same person can be drawn again in other shots. 60 to 90 words, one paragraph, present tense, appearance only: apparent age range, face shape and features, eyes, eyebrows, skin tone, hair (colour, length, style), makeup, and the outfit and accessories. No name, no guesses about personality, no camera or lighting words.";
export const SCENE_DESCRIPTION_PROMPT =
  "Describe this place for an image generator, so the same location can be drawn again from other angles. 50 to 80 words, one paragraph: the kind of room, its architecture, the main furniture and objects (with their positions), materials, colours and the light. No people, no camera words.";
export const OPINION_PROMPT =
  "You are checking a reference picture for an AI character pack (a close-up, a 3/4 face and neck-cropped full-body views will be generated from it, and later lip sync). In 3 short bullet points, say plainly what will work well and what may cause problems (face visibility, lighting, occlusions such as a veil, expression, resolution). Then one line: Ready, Usable with fix, or Not suitable.";

// ---- cost ----

export type CostPlan = { perModel: { id: ModelId; images: number; usd: number }[]; visionUsd: number; baseUsd: number; worstUsd: number };

// Base = every view and angle once + the description drafts; worst = every view made 3 times (2 retries).
export function estimate(models: ModelId[], opts: { views: number; angles: number; retries: number; vision: number }): CostPlan {
  const perModel = models.map((id) => {
    const images = opts.views + opts.angles;
    return { id, images, usd: images * MODELS[id].perImageUsd };
  });
  const visionUsd = opts.vision * VISION.perCallUsd;
  const baseUsd = perModel.reduce((s, m) => s + m.usd, 0) + visionUsd;
  const worstUsd = baseUsd + models.reduce((s, id) => s + opts.views * opts.retries * MODELS[id].perImageUsd, 0);
  return { perModel, visionUsd, baseUsd, worstUsd };
}

export const money = (usd: number) => `$${usd.toFixed(2)}`;

// A running budget: a call is made only while the estimate spent so far + this call stays within the cap.
export class Budget {
  spent = 0;
  constructor(readonly cap: number) {}
  canSpend(usd: number): boolean {
    return this.spent + usd <= this.cap + 1e-9;
  }
  spend(usd: number): void {
    this.spent += usd;
  }
}

// ---- face scores ----

export type Thresholds = { red_below: number; green_from: number; source: string };
export const DEFAULT_THRESHOLDS: Thresholds = { red_below: 0.25, green_from: 0.363, source: "SFace's defaults, not calibrated yet" };

export type Light = "green" | "amber" | "red" | "grey";
export type FaceResult = { score: number | null; face_px?: number; yaw?: number | null; note?: string };

// A face view is a close-up: the face is at least this fraction of the picture's height (per view: View.minFace).
export const minFaceFor = (view: ViewId): number | null => VIEWS.find((x) => x.id === view)?.minFace ?? null;
// A face turned more than this far (degrees) is not a face view any more: both eyes should be visible.
export const MAX_YAW = 70;
export const MIN_JUDGED_FACE_PX = 64; // smaller faces (e.g. in a full-body view) give unreliable scores

export function classify(view: ViewId, r: FaceResult, t: Thresholds, frame_h?: number | null): { light: Light; text: string; regenerate: boolean } {
  const v = VIEWS.find((x) => x.id === view)!;
  if (!v.face) {
    // A neck-cropped body view must show no face: faces come only from the close-up.
    if (r.score !== null && (r.face_px ?? 0) >= 40) return { light: "red", text: "A face is visible: the view should be cropped at the neck.", regenerate: true };
    return { light: "grey", text: "No face, as asked (cropped at the neck): judge the outfit and body by eye.", regenerate: false };
  }
  if (r.score === null) return { light: "red", text: `No face found${r.note ? ` (${r.note})` : ""}.`, regenerate: true };
  const need = v.minFace;
  if (need && frame_h && r.face_px && r.face_px / frame_h < need)
    return { light: "red", text: `Not a close-up: the face is ${Math.round((r.face_px / frame_h) * 100)}% of the picture's height, needs ${Math.round(need * 100)}%.`, regenerate: true };
  if (r.yaw !== null && r.yaw !== undefined && Math.abs(r.yaw) > MAX_YAW)
    return { light: "red", text: `Turned away: the face is turned ${Math.round(Math.abs(r.yaw))}°, both eyes should be visible.`, regenerate: true };
  const s = r.score.toFixed(2);
  const small = (r.face_px ?? 0) < MIN_JUDGED_FACE_PX;
  if (r.score >= t.green_from) return { light: "green", text: `Same person (${s}).`, regenerate: false };
  if (r.score >= t.red_below) return { light: "amber", text: `Probably the same person (${s}): check by eye.`, regenerate: false };
  if (small) return { light: "amber", text: `Low score (${s}) but the face is only ${r.face_px} px: too small to judge, check by eye.`, regenerate: false };
  return { light: "red", text: `Drifted: looks like another person (${s}).`, regenerate: true };
}

// Does the head turn match the view asked for? Information only.
export function angleNote(view: View, yaw: number | null | undefined): string | null {
  if (!view.expectYaw || yaw === null || yaw === undefined) return null;
  const a = Math.abs(yaw);
  const [lo, hi] = view.expectYaw;
  if (a < lo - 5) return `turned only ${a.toFixed(0)}° (asked for a ${view.label.toLowerCase()})`;
  if (a > hi + 10) return `turned ${a.toFixed(0)}° (more than a ${view.label.toLowerCase()})`;
  return null;
}

export function safeName(text: string): string {
  const clean = text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return (clean || "untitled").slice(0, 60).trim();
}

// The size of a PNG or JPEG from its header (downloaded files may be JPEG bytes with a .png name). Null if unreadable.
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = dv.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}
