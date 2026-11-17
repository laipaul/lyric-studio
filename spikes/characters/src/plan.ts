// Pure logic of the C1 spike (no files, no network): the views, the prompts, what each model is sent, what it costs,
// how a face score reads (green / amber / red) and when a view is made again. Tested in test/characters.test.ts.

// ---- what is generated ----

export type ViewId = "front" | "three_quarter" | "profile" | "full_body";
export type AngleId = "wide_left" | "wide_right" | "detail";
export type Aspect = "3:4" | "2:3";

export const VIEWS: { id: ViewId; label: string; aspect: Aspect; expectYaw: [number, number] | null; prompt: string }[] = [
  {
    id: "front",
    label: "Front portrait",
    aspect: "3:4",
    expectYaw: [0, 20],
    prompt: "A head-and-shoulders portrait of her facing the camera straight on, looking into the lens, relaxed neutral expression, mouth gently closed.",
  },
  {
    id: "three_quarter",
    label: "3/4 view",
    aspect: "3:4",
    expectYaw: [20, 60],
    prompt: "A head-and-shoulders portrait of her with the head turned about 45 degrees to her left (a three-quarter view), eyes following the turn, relaxed neutral expression.",
  },
  {
    id: "profile",
    label: "Profile",
    aspect: "3:4",
    expectYaw: null, // a true profile is often beyond what the face models can measure
    prompt: "A head-and-shoulders portrait of her in full side profile, facing to the left (90 degrees), relaxed neutral expression.",
  },
  {
    id: "full_body",
    label: "Full body",
    aspect: "2:3",
    expectYaw: [0, 35],
    prompt: "A full-length photograph of her from head to toe, standing naturally and facing the camera, arms relaxed, the whole outfit visible.",
  },
];

export const PACK_STYLE =
  "Use the reference picture as BOTH the identity and the style reference: the same woman (the same face, features, skin tone, hair and makeup), the same outfit, and the same visual style, colour grading, lens look and rendering as the reference. Do not change her identity, age or ethnicity. Plain seamless mid-grey studio background, soft even light, no text, no other people.";

export const ANGLES: { id: AngleId; label: string; prompt: string }[] = [
  { id: "wide_left", label: "Wide, from the left", prompt: "A wide view of this same place seen from the left side of the room, showing more of it." },
  { id: "wide_right", label: "Wide, from the right", prompt: "A wide view of this same place seen from the right side of the room, as if the camera walked across it." },
  { id: "detail", label: "Closer detail", prompt: "A closer view of the main feature of this place (for example the mirror or the window), as a detail shot." },
];

export const SCENE_STYLE =
  "Use the reference picture as BOTH the location and the style reference: the same room with the same architecture, furniture, colours, materials and light, and the same visual style, colour grading and rendering. Only the camera position changes. Keep it empty: no people. No text.";

export function viewPrompt(v: (typeof VIEWS)[number]): string {
  return `${v.prompt} ${PACK_STYLE}`;
}
export function anglePrompt(a: (typeof ANGLES)[number]): string {
  return `${a.prompt} ${SCENE_STYLE}`;
}

// ---- the image models (fal endpoints, inputs and prices checked on fal.ai on 17 Nov 2026) ----

export type ModelId = "nano-pro" | "nano2" | "seedream" | "gpt";
export const MODEL_IDS: readonly ModelId[] = ["nano-pro", "nano2", "seedream", "gpt"];

export type ImageModel = {
  id: ModelId;
  name: string;
  endpoint: string;
  perImageUsd: number; // the estimate per image, from fal's price
  priceNote: string;
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
};

export const VISION = { endpoint: "fal-ai/any-llm/vision", model: "google/gemini-2.5-flash-lite", perCallUsd: 0.01 };

export const DESCRIPTION_PROMPT =
  "Describe the woman in this picture for an image generator, so the same person can be drawn again in other shots. 60 to 90 words, one paragraph, present tense, appearance only: apparent age range, face shape and features, eyes, eyebrows, skin tone, hair (colour, length, style), makeup, and the outfit and accessories. No name, no guesses about personality, no camera or lighting words.";
export const SCENE_DESCRIPTION_PROMPT =
  "Describe this place for an image generator, so the same location can be drawn again from other angles. 50 to 80 words, one paragraph: the kind of room, its architecture, the main furniture and objects (with their positions), materials, colours and the light. No people, no camera words.";
export const OPINION_PROMPT =
  "You are checking a reference picture for an AI character pack (front, 3/4, profile and full-body views will be generated from it, and later lip sync). In 3 short bullet points, say plainly what will work well and what may cause problems (face visibility, lighting, occlusions such as a veil, expression, resolution). Then one line: Ready, Usable with fix, or Not suitable.";

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
export const DEFAULT_THRESHOLDS: Thresholds = { red_below: 0.25, green_from: 0.363, source: "SFace's defaults (not calibrated on your pictures yet)" };

export type Light = "green" | "amber" | "red" | "grey";
export type FaceResult = { score: number | null; face_px?: number; yaw?: number | null; note?: string };

export const MIN_JUDGED_FACE_PX = 64; // smaller faces (e.g. in a full-body view) give unreliable scores

export function classify(view: ViewId, r: FaceResult, t: Thresholds): { light: Light; text: string; regenerate: boolean } {
  if (r.score === null) {
    if (view === "profile") return { light: "grey", text: "Profile: not measurable by the face model (it needs both eyes); judge it by eye.", regenerate: false };
    return { light: "red", text: `No face found${r.note ? ` (${r.note})` : ""}.`, regenerate: true };
  }
  const s = r.score.toFixed(2);
  const small = (r.face_px ?? 0) < MIN_JUDGED_FACE_PX;
  if (r.score >= t.green_from) return { light: "green", text: `Same person (${s}).`, regenerate: false };
  if (r.score >= t.red_below) return { light: "amber", text: `Probably the same person (${s}): check by eye.`, regenerate: false };
  if (small) return { light: "amber", text: `Low score (${s}) but the face is only ${r.face_px} px: too small to judge, check by eye.`, regenerate: false };
  if (view === "profile") return { light: "amber", text: `Low score (${s}) on a profile, where the face model is unreliable: check by eye.`, regenerate: false };
  return { light: "red", text: `Drifted: looks like another person (${s}).`, regenerate: true };
}

// Does the head turn match the view asked for? Information only.
export function angleNote(view: (typeof VIEWS)[number], yaw: number | null | undefined): string | null {
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
