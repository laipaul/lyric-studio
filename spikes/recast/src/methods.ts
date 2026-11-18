// The recast methods behind one adapter. A method is one or more fal requests ("steps"); each step lists candidate
// endpoint IDs (the first one fal describes wins, see schema.ts), what it wants to send by role, and how its cost is
// counted. Adding a provider (Higgsfield Genjutsu, Runway Aleph) = one more entry here; the stubs say why they do not run.
import type { Wants } from "./schema";

export type MethodId = "wan" | "h3" | "keyframe" | "aleph" | "genjutsu";
export const METHOD_IDS: readonly MethodId[] = ["wan", "h3", "keyframe", "aleph", "genjutsu"];
export const DEFAULT_METHODS: readonly MethodId[] = ["wan", "h3", "keyframe"];

export type Quality = "draft" | "high";

export type ClipInfo = { file: string; width: number; height: number; fps: number; durationS: number };
export type Refs = { closeup: string; threeQuarter: string; reference: string }; // local files
export type Urls = { clip: string; closeup: string; threeQuarter: string; reference: string; frame?: string; depth?: string; keyframe?: string };

export type Step = {
  key: string; // file name stem and report key
  label: string;
  candidates: string[];
  output: "video" | "image";
  fallbackPrice: (q: Quality) => string; // key in FALLBACK_PRICES
  // seconds billed (video steps) or megapixels (pictures); fpsFactor when fal bills frames normalised to 16 fps
  units: (c: ClipInfo) => { seconds?: number; megapixels?: number; fpsFactor?: number; note?: string };
  wants: (c: ClipInfo, u: Urls, q: Quality) => Wants;
};

export type Method = { id: MethodId; letter: string; name: string; stub?: string; steps: Step[] };

export const REPLACE_PROMPT =
  "Replace the main person in the video with the person in the reference pictures: the same face, hair and features as in the pictures. Keep the clothes, the movement, the camera, the framing, the background, the light and the timing of the video exactly as they are.";

export const KEYFRAME_PROMPT =
  "Image 1 is a frame from a film. Image 2 is its depth map. Images 3 to 5 show one person (the character). Redraw image 1 with the character in place of the person in it: the same position, pose, size in the frame, camera angle and composition (follow the depth map of image 2 exactly), and the same background, light, colours and clothes as image 1. Only the face, hair and features change: they come from images 3 to 5. Photorealistic, the same film look as image 1.";

export const MOTION_PROMPT =
  "The person in the first frame performs exactly the movement of the reference video: the same gestures, head and body motion, timing and camera movement, from start to end. Keep the first frame's person, face, scene, light and colours throughout. Photorealistic, natural motion.";

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

const fps16 = (c: ClipInfo) => Math.max(1, Math.min(2, (c.fps || 16) / 16));

export const METHODS: Record<MethodId, Method> = {
  wan: {
    id: "wan",
    letter: "A",
    name: "Wan 2.2 Animate Replace",
    steps: [
      {
        key: "wan",
        label: "Wan 2.2 Animate Replace",
        candidates: ["fal-ai/wan/v2.2-14b/animate/replace"],
        output: "video",
        fallbackPrice: (q) => (q === "draft" ? "wan-480p" : "wan-720p"),
        units: (c) => ({ seconds: c.durationS, fpsFactor: fps16(c), note: c.fps > 16 ? `billed as ${c.fps.toFixed(0)} fps normalised to 16 fps (×${fps16(c).toFixed(2)}), as other sites report` : undefined }),
        wants: (c, u, q) => ({ video: u.clip, images: [u.closeup, u.reference, u.threeQuarter], resolution: q === "draft" ? ["480p"] : ["720p", "580p", "480p"], prompt: REPLACE_PROMPT, seed: 42, durationS: c.durationS, fps: c.fps, aspect: c.width / c.height }),
      },
    ],
  },
  h3: {
    id: "h3",
    letter: "B",
    name: "MiniMax H3 Max Recast",
    steps: [
      {
        key: "h3",
        label: "MiniMax H3 Max Recast",
        candidates: ["minimax/h3-max/recast", "fal-ai/minimax-h3-max-recast"],
        output: "video",
        fallbackPrice: (q) => (q === "draft" ? "h3-768p" : "h3-1080p"),
        units: (c) => ({ seconds: c.durationS }),
        wants: (c, u, q) => ({ video: u.clip, images: [u.closeup, u.threeQuarter, u.reference], resolution: q === "draft" ? ["768P", "768p", "720p", "720P"] : ["1080P", "1080p"], prompt: REPLACE_PROMPT, seed: 42, durationS: c.durationS, aspect: c.width / c.height }),
      },
    ],
  },
  keyframe: {
    id: "keyframe",
    letter: "C",
    name: "Keyframe + Seedance",
    steps: [
      {
        key: "depth",
        label: "Depth map of the first frame",
        candidates: ["fal-ai/imageutils/depth", "fal-ai/image-preprocessors/depth-anything/v2"],
        output: "image",
        fallbackPrice: () => "depth",
        units: () => ({}),
        wants: (_c, u) => ({ image: u.frame }),
      },
      {
        key: "keyframe",
        label: "New first frame (Seedream 4.5, depth-guided)",
        candidates: ["fal-ai/bytedance/seedream/v4.5/edit"],
        output: "image",
        fallbackPrice: () => "seedream",
        units: () => ({}),
        wants: (c, u) => ({ images: [u.frame!, u.depth!, u.closeup, u.threeQuarter, u.reference], prompt: KEYFRAME_PROMPT, imageSize: keyframeSize(c.width / c.height), seed: 42 }),
      },
      {
        key: "seedance",
        label: "Seedance reference video-to-video",
        candidates: ["bytedance/seedance-2.0/reference-to-video", "fal-ai/bytedance/seedance/v2/reference-to-video", "bytedance/seedance-2.0/fast/reference-to-video"],
        output: "video",
        fallbackPrice: () => "seedance-480p",
        units: (c) => ({ seconds: Math.ceil(c.durationS - 0.05) }),
        wants: (c, u) => ({ video: u.clip, firstFrame: u.keyframe, prompt: MOTION_PROMPT, resolution: ["480p"], durationS: c.durationS, aspect: c.width / c.height, seed: 42 }),
      },
    ],
  },
  aleph: { id: "aleph", letter: "D", name: "Runway Aleph", stub: "skipped in this run: no Runway key yet.", steps: [] },
  genjutsu: { id: "genjutsu", letter: "E", name: "Higgsfield Genjutsu", stub: "not connected yet (the adapter slot is ready).", steps: [] },
};

// --methods "wan,h3,keyframe"; --keyframe-clips limits C to some clips (the first run: the close-up only).
export function parseMethods(text: string | undefined): MethodId[] {
  const list = (text ?? DEFAULT_METHODS.join(",")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const alias: Record<string, MethodId> = { a: "wan", b: "h3", c: "keyframe", d: "aleph", e: "genjutsu", seedance: "keyframe" };
  const out = list.map((x) => alias[x] ?? x);
  const bad = out.filter((x) => !(METHOD_IDS as readonly string[]).includes(x));
  if (bad.length) throw new Error(`Unknown method "${bad.join(", ")}": use ${METHOD_IDS.join(", ")} (or A–E).`);
  return [...new Set(out)] as MethodId[];
}
