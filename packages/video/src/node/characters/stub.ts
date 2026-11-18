// Stand-ins for fal and the face checks, for the browser tests only: switched on by LYRIC_CARDS_STUB=<folder of
// pictures> (closeup.png, three_quarter.png, body_front.png, body_back.png, wide_left.png, … else default.png).
// Nothing goes to fal.ai and no face models are needed. Never set in normal use.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { FalClient } from "@fal-ai/client";

import type { FaceTool } from "./face";

export function stubFal(dir: string): FalClient {
  let n = 0;
  const inputs = new Map<string, { endpoint: string; input: Record<string, unknown> }>();
  const pick = (prompt: string) => {
    const key = /close-up portrait of this person's face and/i.test(prompt)
      ? "closeup"
      : /three-quarter/i.test(prompt)
        ? "three_quarter"
        : /from the front/i.test(prompt)
          ? "body_front"
          : /seen from behind/i.test(prompt)
            ? "body_back"
            : /left side of the room/i.test(prompt)
              ? "wide_left"
              : /OPPOSITE side/i.test(prompt)
                ? "wide_right"
                : /closer view/i.test(prompt)
                  ? "detail"
                  : "default";
    const file = path.join(dir, `${key}.png`);
    return existsSync(file) ? file : path.join(dir, "default.png");
  };
  const dataUrl = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  return {
    storage: { upload: async () => dataUrl(path.join(dir, "default.png")) },
    queue: {
      submit: async (endpoint: string, o: { input: Record<string, unknown> }) => {
        const id = `stub-${++n}`;
        inputs.set(id, { endpoint, input: o.input });
        return { request_id: id };
      },
      status: async () => ({ status: "COMPLETED" }),
      result: async (_e: string, o: { requestId: string }) => {
        const job = inputs.get(o.requestId)!;
        if (job.endpoint === "fal-ai/any-llm") {
          // The outfit split: valid JSON in a code fence (as models often answer).
          const outfit = /Outfit text:\n([\s\S]*)$/.exec(String(job.input.prompt ?? ""))?.[1]?.trim() ?? "";
          const json = { closeups: "neckline and veil at the head", front: `front of the outfit (from: ${outfit})`, back: `back of the outfit (from: ${outfit})` };
          return { data: { output: `\`\`\`json\n${JSON.stringify(json)}\n\`\`\`` }, requestId: o.requestId };
        }
        if (job.endpoint.includes("any-llm")) return { data: { output: "A woman in her twenties with an oval face, dark eyes, long dark hair in a low bun, a white dress and a sheer veil." }, requestId: o.requestId };
        return { data: { images: [{ url: dataUrl(pick(String(job.input.prompt ?? ""))) }] }, requestId: o.requestId };
      },
      cancel: async () => undefined,
    },
  } as unknown as FalClient;
}

export function stubFace(): FaceTool {
  const ready = { file: "", measures: { faces: 1, face_px: 900 }, verdict: "Ready" as const, reasons: [{ level: "ok" as const, text: "One face (confidence 0.94).", check: "faces" }, { level: "ok" as const, text: "The face is 900 px tall.", check: "size" }], fixes: [] };
  return {
    check: async (image) => ({ ...ready, file: image }),
    sceneCheck: async (image) => ({ ...ready, file: image, reasons: [{ level: "ok", text: "Size 1456×816.", check: "size" }] }),
    compare: async (_ref, files) => ({ results: files.map((f) => ({ file: f, score: /body_/.test(path.basename(f)) ? null : 0.62, face_px: 400, yaw: /three_quarter/.test(f) ? 40 : 2 })) }),
    calibrate: async (reference) => ({ reference, same_picture: [], others: [], thresholds: { red_below: 0.458, green_from: 0.528, top_other: 0.428, others_used: 3, note: null } }),
    crop: async (image, out) => {
      copyFileSync(image, out);
      return { file: out };
    },
    cropBody: async (image, out) => {
      copyFileSync(image, out);
      return { file: out, cropped: true, cut_y: 10 };
    },
    sheet: async (spec) => {
      copyFileSync(spec.rows[0].cells[0].file, spec.out);
      return { file: spec.out };
    },
  };
}
