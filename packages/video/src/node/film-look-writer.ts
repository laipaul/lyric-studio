// "Write it from the still" (Film looks, 22 Nov 2026): the app reads the reference still (a ShotDeck screenshot with its
// data block under the frame, a Midjourney frame or a photo) and writes the look line and the Midjourney words, so
// Paul never needs camera words himself. Gemini on his own GEMINI_API_KEY (a text answer about one picture, well
// under a cent); without it, fal's vision model on FAL_KEY. Keys only ever come from .env.
// The browser tests and the cloud use a stand-in (LYRIC_GENERATE_STUB / LYRIC_CARDS_STUB): nothing is sent.
import { readFileSync } from "node:fs";
import path from "node:path";

import { GEMINI_API } from "./characters/gemini";
import { LOOK_LINE_MAX, MIDJOURNEY_MAX } from "./film-looks";

export const LOOK_WRITER_PROMPT =
  "This is a reference frame for a music video. It may be a ShotDeck screenshot with a data block under the frame " +
  "(camera, lens, film stock, lighting, colour codes). Describe its film look so that every clip of the video can share it. " +
  'Answer with JSON only: {"line": "...", "midjourney": "..."}. ' +
  '"line": one line of 15 to 35 words for a video generator: the camera body, the lens and focal feel, film stock or grain, ' +
  "the colour grade (warm or cool, contrast, the main colours), the quality and direction of the light, and the depth of field. " +
  "When the data block names the camera, lens or film stock, use those exact names. The look only: no people, no clothes, " +
  "no place, no story, no motion, no camera moves. " +
  '"midjourney": the same look as words to add to a Midjourney prompt, 20 to 45 words, ending with "--style raw". No image links.';

export const WRITER_MODEL = () => process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-2.5-flash";
const FAL_VISION = { endpoint: "https://fal.run/fal-ai/any-llm/vision", model: "google/gemini-2.5-flash" };

export type WrittenLook = { line: string; midjourney: string; by: string };

export function writerReady(env: NodeJS.ProcessEnv = process.env): { ready: boolean; how: string } {
  if (env.LYRIC_GENERATE_STUB || env.LYRIC_CARDS_STUB) return { ready: true, how: "stand-in (tests)" };
  if (env.GEMINI_API_KEY?.trim()) return { ready: true, how: "Gemini, on your key (less than a cent)" };
  if (env.FAL_KEY?.trim()) return { ready: true, how: "fal, on your key (about $0.01)" };
  return { ready: false, how: "Add GEMINI_API_KEY (or FAL_KEY) to D:\\videomaker\\.env to let the app write it. You can always type it yourself." };
}

// The JSON in a model's answer (it may come inside ``` fences or with words around it).
export function parseWritten(text: string): { line: string; midjourney: string } {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error("The answer had no look in it: try again, or type the line yourself.");
  let j: { line?: unknown; midjourney?: unknown };
  try {
    j = JSON.parse(m[0]) as typeof j;
  } catch {
    throw new Error("The answer could not be read: try again, or type the line yourself.");
  }
  const tidy = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const line = tidy(j.line, LOOK_LINE_MAX).replace(/\.$/, "");
  if (!line) throw new Error("The answer had no look line: try again, or type it yourself.");
  return { line, midjourney: tidy(j.midjourney, MIDJOURNEY_MAX) };
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export async function writeLookFromStill(still: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<WrittenLook> {
  if (env.LYRIC_GENERATE_STUB || env.LYRIC_CARDS_STUB) {
    return { line: "35mm film grain, ARRI Alexa 35 look, warm tungsten light, soft contrast, gentle highlight roll-off, shallow depth of field", midjourney: "shot on 35mm film, ARRI Alexa 35, warm tungsten light, soft contrast, creamy shallow depth of field, cinematic colour grade --style raw", by: "stand-in" };
  }
  const data = readFileSync(still).toString("base64");
  const mimeType = MIME[path.extname(still).toLowerCase()] ?? "image/jpeg";
  const gemini = env.GEMINI_API_KEY?.trim();
  if (gemini) {
    const model = WRITER_MODEL();
    const r = await fetchImpl(`${GEMINI_API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": gemini, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: LOOK_WRITER_PROMPT }, { inlineData: { mimeType, data } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } };
    if (!r.ok) throw new Error(`Gemini answered HTTP ${r.status}${j.error?.message ? `: ${j.error.message}` : ""}`);
    if (j.promptFeedback?.blockReason) throw new Error(`Gemini refused this picture (${j.promptFeedback.blockReason})`);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { ...parseWritten(text), by: `Gemini (${model})` };
  }
  const fal = env.FAL_KEY?.trim();
  if (fal) {
    const r = await fetchImpl(FAL_VISION.endpoint, {
      method: "POST",
      headers: { Authorization: `Key ${fal}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: FAL_VISION.model, prompt: LOOK_WRITER_PROMPT, image_url: `data:${mimeType};base64,${data}` }),
    });
    const j = (await r.json().catch(() => ({}))) as { output?: string; detail?: unknown };
    if (!r.ok) throw new Error(`fal answered HTTP ${r.status}`);
    return { ...parseWritten(String(j.output ?? "")), by: "fal" };
  }
  throw new Error(writerReady(env).how);
}
