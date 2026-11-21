// Gemini (Nano Banana Pro) for a card's pack, on the user's own GEMINI_API_KEY (Paul, 21 Nov 2026: "I am happy with
// Gemini"). Google's generateContent answers at once (no queue), so this is a small stand-in with the same shape as the
// fal client the pack code uses: upload = the picture as a data URL, submit = the call, result = the image as a data URL.
// The key only ever comes from .env and is never written anywhere.
import type { FalClient } from "@fal-ai/client";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_KEY_MISSING =
  "No GEMINI_API_KEY in .env: add a line GEMINI_API_KEY=<your key from aistudio.google.com → Get API key> to D:\\videomaker\\.env, then restart Lyric Studio.";

const fromDataUrl = (url: string) => {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url);
  if (!m) throw new Error("Gemini: a reference picture could not be read");
  return { mimeType: m[1], data: m[2] };
};

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };

// The first picture in Gemini's answer, as a data URL; a refusal or a text-only answer becomes a plain error.
export function geminiImage(answer: unknown): string {
  const a = answer as { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string }; error?: { message?: string } };
  if (a.error?.message) throw new Error(`Gemini: ${a.error.message}`);
  if (a.promptFeedback?.blockReason) throw new Error(`Gemini refused the request (${a.promptFeedback.blockReason})`);
  const c = a.candidates?.[0];
  for (const p of c?.content?.parts ?? []) {
    const d = p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined);
    if (d?.data) return `data:${d.mimeType ?? "image/png"};base64,${d.data}`;
  }
  const said = (c?.content?.parts ?? []).map((p) => p.text ?? "").join(" ").trim();
  throw new Error(`Gemini gave no picture${c?.finishReason ? ` (${c.finishReason})` : ""}${said ? `: "${said.slice(0, 160)}"` : ""}`);
}

export function geminiClient(key: string, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)): FalClient {
  let n = 0;
  const done = new Map<string, { url?: string; error?: Error }>();
  return {
    storage: {
      upload: async (file: Blob) => `data:${file.type || "image/png"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
    },
    queue: {
      // endpoint: "gemini/<model>"; input: { prompt, image_urls (data URLs), aspect_ratio, image_size }
      submit: async (endpoint: string, o: { input: Record<string, unknown> }) => {
        const id = `gemini-${Date.now()}-${++n}`;
        const i = o.input;
        const model = endpoint.replace(/^gemini\//, "");
        const parts = [{ text: String(i.prompt ?? "") }, ...((i.image_urls as string[]) ?? []).map((u) => ({ inlineData: fromDataUrl(u) }))];
        const body = { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: i.aspect_ratio, imageSize: i.image_size } } };
        try {
          const r = await fetchImpl(`${GEMINI_API}/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const j = (await r.json().catch(() => ({}))) as unknown;
          if (!r.ok) throw new Error(`Gemini answered HTTP ${r.status}${(j as { error?: { message?: string } }).error?.message ? `: ${(j as { error: { message: string } }).error.message}` : ""}`);
          done.set(id, { url: geminiImage(j) });
        } catch (error) {
          done.set(id, { error: error as Error });
        }
        return { request_id: id };
      },
      status: async () => ({ status: "COMPLETED" }),
      result: async (_e: string, o: { requestId: string }) => {
        const r = done.get(o.requestId);
        if (!r) throw new Error("Gemini: this picture is no longer available (make it again)");
        if (r.error) throw r.error;
        return { data: { images: [{ url: r.url }] }, requestId: o.requestId };
      },
      cancel: async () => undefined,
    },
  } as unknown as FalClient;
}
