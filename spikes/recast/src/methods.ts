// The recast methods behind one adapter. A method is one or more fal requests ("steps"); each step lists candidate
// endpoint IDs (the first one fal describes wins, see schema.ts), what it wants to send by role, and how its cost is
// counted. Adding a provider (Higgsfield Genjutsu, Runway Aleph) = one more entry here; the stubs say why they do not run.
import { kling720Size } from "./media";
import type { Wants } from "./schema";

export type MethodId = "wan" | "h3" | "keyframe" | "kwan" | "aleph" | "genjutsu";
export const METHOD_IDS: readonly MethodId[] = ["wan", "h3", "keyframe", "kwan", "aleph", "genjutsu"];
export const DEFAULT_METHODS: readonly MethodId[] = ["wan", "h3", "keyframe", "kwan"];

export type Quality = "draft" | "high";

// The prepared copy of a clip a method gets: "orig" (the clip as it is), "pad916" (centred on a black 9:16 canvas),
// "kling720" (scaled up so both sides are at least 720 px, at least 24 fps). Each is uploaded once per clip.
export type Variant = "orig" | "pad916" | "kling720";

export type ClipInfo = { file: string; width: number; height: number; fps: number; durationS: number };
export type Refs = { closeup: string; threeQuarter: string; reference: string }; // local files
export type Urls = { clip: string; closeup: string; threeQuarter: string; reference: string; frame?: string; keyframe?: string; keyframePad?: string };

// The picture model that makes the new first frame (--keyframe-model), and the seed of this try.
export type KeyframeModel = "seedream" | "nano-pro" | "gpt";
export const KEYFRAME_MODEL_IDS: readonly KeyframeModel[] = ["seedream", "nano-pro", "gpt"];
export const DEFAULT_KEYFRAME_MODEL: KeyframeModel = "nano-pro";
export const KEYFRAME_MODELS: Record<KeyframeModel, { name: string; endpoint: string }> = {
  seedream: { name: "Seedream 4.5", endpoint: "fal-ai/bytedance/seedream/v4.5/edit" },
  "nano-pro": { name: "Nano Banana Pro", endpoint: "fal-ai/nano-banana-pro/edit" },
  gpt: { name: "GPT Image 1.5", endpoint: "fal-ai/gpt-image-1.5/edit" },
};
export type Opts = { keyframeModel: KeyframeModel; seed: number };

export type Step = {
  key: string; // file name stem and report key
  label: string;
  candidates: string[];
  output: "video" | "image";
  variant?: Variant; // video steps: which prepared copy of the clip is sent (and, for pad916, which fit-back applies)
  priceFormula: string | ((o: Opts) => string); // key in pricing.FORMULAS
  formulaFirst?: boolean; // the documented formula wins over fal's list (the price depends on resolution, frames, tokens)
  // seconds billed (video steps) or megapixels (pictures); fpsFactor when fal bills frames normalised to 16 fps
  units: (c: ClipInfo) => { seconds?: number; megapixels?: number; fpsFactor?: number; note?: string };
  wants: (c: ClipInfo, u: Urls, q: Quality, o: Opts) => Wants;
};

export type Method = { id: MethodId; letter: string; name: string; stub?: string; steps: Step[]; precheck?: (c: ClipInfo) => string | null };

export const REPLACE_PROMPT =
  "Replace the main person in the video with the person in the reference pictures: the same face, hair and features as in the pictures. Keep the clothes, the movement, the camera, the framing, the background, the light and the timing of the video exactly as they are.";

// Image 1 = the clip's first frame, image 2 = the close-up, image 3 = the 3/4 face (the order matters).
export const KEYFRAME_PROMPT =
  "Replace the person in image 1 with the person in images 2 and 3: their face, hair and features. Keep everything else in image 1 exactly as it is: pose, position, size in the frame, clothes, background, light, colours and camera. Photorealistic.";

export const KLING_PROMPT =
  "Replace the main person in the video with @Element1: the same face, hair and features. The first frame should look like @Image1. Keep the movement, the camera, the framing, the background, the light and the colours of the video exactly as they are.";

// Seedream 4.5 needs at least 2560x1440 pixels in total (C1): the clip's shape at that size, long side at most 4096.
export function keyframeSize(aspect: number): { width: number; height: number } {
  const area = 2560 * 1440;
  let w = Math.sqrt(area * aspect);
  let h = w / aspect;
  const s = Math.min(1, 4096 / Math.max(w, h));
  w *= s;
  h *= s;
  const up = (x: number) => Math.ceil(x / 16) * 16;
  return { width: up(w), height: up(h) };
}

const fps16 = (c: ClipInfo) => (c.fps || 16) / 16;
const WAN_ENDPOINT = ["fal-ai/wan/v2.2-14b/animate/replace"];
const wanUnits = (c: ClipInfo) => ({ seconds: c.durationS, fpsFactor: fps16(c) });

// The step both keyframe methods share: the new first frame, made once per clip and counted once. No depth map: the
// picture models do not condition on one (the first run's Seedream answered with the unchanged frame).
export function keyframeWants(model: KeyframeModel, c: ClipInfo, u: Urls, seed: number): Wants {
  const images = [u.frame!, u.closeup, u.threeQuarter];
  const aspect = c.width / c.height;
  const common = { images, prompt: KEYFRAME_PROMPT, seed };
  if (model === "nano-pro") return { ...common, aspect, resolution: ["2K"], extra: { num_images: 1, output_format: "png" } };
  if (model === "gpt") return { images, prompt: KEYFRAME_PROMPT, imageSizeText: aspect > 1.15 ? "1536x1024" : aspect < 0.87 ? "1024x1536" : "1024x1024", extra: { quality: "high", input_fidelity: "high", num_images: 1, output_format: "png" } };
  return { ...common, imageSize: keyframeSize(aspect), extra: { num_images: 1, max_images: 1 } };
}

const KEYFRAME_STEPS: Step[] = [
  {
    key: "keyframe",
    label: "New first frame",
    candidates: Object.values(KEYFRAME_MODELS).map((m) => m.endpoint),
    output: "image",
    priceFormula: (o) => o.keyframeModel,
    units: () => ({}),
    wants: (c, u, _q, o) => keyframeWants(o.keyframeModel, c, u, o.seed),
  },
];
export const isSharedStep = (key: string) => key === "keyframe";

const klingRefusal = (c: ClipInfo): string | null => {
  if (c.durationS > 10.05) return `Kling takes a clip of at most 10 s (this one is ${c.durationS.toFixed(1)} s).`;
  if (c.durationS < 3) return `Kling takes a clip of at least 3 s (this one is ${c.durationS.toFixed(1)} s).`;
  const k = kling720Size(c.width, c.height);
  if (Math.max(k.width, k.height) > 2160) return "Kling takes a picture of at most 2160 px on a side.";
  return null;
};

export const METHODS: Record<MethodId, Method> = {
  wan: {
    id: "wan",
    letter: "A",
    name: "Wan 2.2 Animate Replace",
    steps: [
      {
        key: "wan",
        label: "Wan 2.2 Animate Replace",
        candidates: WAN_ENDPOINT,
        output: "video",
        variant: "pad916",
        priceFormula: "wan",
        formulaFirst: true,
        units: wanUnits,
        wants: (c, u, q) => ({ video: u.clip, images: [u.closeup], resolution: q === "draft" ? ["480p"] : ["720p", "580p", "480p"], prompt: REPLACE_PROMPT, seed: 42, durationS: c.durationS, fps: c.fps }),
      },
    ],
  },
  h3: {
    id: "h3",
    letter: "B",
    name: "MiniMax H3 Max Recast",
    precheck: (c) => (c.durationS < 5 ? `MiniMax needs a clip of at least 5 s (this one is ${c.durationS.toFixed(1)} s).` : null),
    steps: [
      {
        key: "h3",
        label: "MiniMax H3 Max Recast",
        candidates: ["minimax/h3-max/recast", "fal-ai/minimax-h3-max-recast"],
        output: "video",
        variant: "orig",
        priceFormula: "h3",
        formulaFirst: true,
        units: (c) => ({ seconds: c.durationS }),
        // ONE photo per new person: the close-up only (more photos would be more people).
        wants: (c, u, q) => ({ video: u.clip, images: [u.closeup], resolution: q === "draft" ? ["768P"] : ["1080P"], prompt: REPLACE_PROMPT, seed: 42, extra: { enhance_realism: true }, durationS: c.durationS }),
      },
    ],
  },
  keyframe: {
    id: "keyframe",
    letter: "C",
    name: "Keyframe + Kling",
    precheck: klingRefusal,
    steps: [
      ...KEYFRAME_STEPS,
      {
        key: "kling",
        label: "Kling O1 video edit",
        candidates: ["fal-ai/kling-video/o1/video-to-video/edit"],
        output: "video",
        variant: "kling720",
        priceFormula: "kling",
        units: (c) => ({ seconds: c.durationS }),
        wants: (_c, u) => ({ video: u.clip, images: [u.keyframe!], elements: [{ frontal: u.closeup, refs: [u.threeQuarter, u.reference] }], prompt: KLING_PROMPT, extra: { keep_audio: false } }),
      },
    ],
  },
  kwan: {
    id: "kwan",
    letter: "F",
    name: "Keyframe + Wan",
    steps: [
      ...KEYFRAME_STEPS,
      {
        key: "kwan",
        label: "Wan 2.2 Animate Replace (new first frame)",
        candidates: WAN_ENDPOINT,
        output: "video",
        variant: "pad916",
        priceFormula: "wan",
        formulaFirst: true,
        units: wanUnits,
        wants: (c, u, q) => ({ video: u.clip, images: [u.keyframePad!], resolution: q === "draft" ? ["480p"] : ["720p", "580p", "480p"], prompt: REPLACE_PROMPT, seed: 42, durationS: c.durationS, fps: c.fps }),
      },
    ],
  },
  aleph: { id: "aleph", letter: "D", name: "Runway Aleph", stub: "skipped in this run: no Runway key yet.", steps: [] },
  genjutsu: { id: "genjutsu", letter: "E", name: "Higgsfield Genjutsu", stub: "not connected yet (the adapter slot is ready).", steps: [] },
};

export const lastStep = (m: Method): Step | undefined => m.steps[m.steps.length - 1];

// --methods "wan,h3,keyframe,kwan"; --keyframe-clips limits both keyframe methods (C and F) to some clips.
export function parseMethods(text: string | undefined): MethodId[] {
  const list = (text ?? DEFAULT_METHODS.join(",")).split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const alias: Record<string, MethodId> = { a: "wan", b: "h3", c: "keyframe", d: "aleph", e: "genjutsu", f: "kwan", kling: "keyframe" };
  const out = list.map((x) => alias[x] ?? x);
  const bad = out.filter((x) => !(METHOD_IDS as readonly string[]).includes(x));
  if (bad.length) throw new Error(`Unknown method "${bad.join(", ")}": use ${METHOD_IDS.join(", ")} (or A–F).`);
  return [...new Set(out)] as MethodId[];
}
