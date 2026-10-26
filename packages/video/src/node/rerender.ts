// "pnpm rerender <v1.manifest.json>": renders a variation again from its manifest, exactly as before.
// Stops with a clear message if the song, a clip or a font file has changed since.
import path from "node:path";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";

import { readManifest, verifyManifest, type Manifest } from "./manifest";
import { renderLyricVideo } from "./render";

export type RerenderResult = { out: string; notes: string[]; manifest: Manifest };

export async function rerender(
  manifestFile: string,
  options: { out?: string; workspaceDir?: string; concurrency?: number; log?: (m: string) => void; onProgress?: (p: number) => void } = {},
): Promise<RerenderResult> {
  const log = options.log ?? (() => {});
  const manifest = readManifest(manifestFile);
  const ws = openWorkspace(options.workspaceDir ?? resolveWorkspaceDir());
  let verification;
  try {
    verification = await verifyManifest(ws, manifest, log);
  } finally {
    ws.close();
  }
  if (verification.problems.length) {
    throw new Error(
      `${manifest.variation.name} cannot be reproduced exactly:\n` +
        verification.problems.map((p) => `  - ${p}`).join("\n") +
        "\nPut the original file(s) back, or make new videos with pnpm make.",
    );
  }
  const out = path.resolve(options.out ?? path.join(path.dirname(manifestFile), `${manifest.variation.name}.rerender.mp4`));
  if (out === path.resolve(path.dirname(manifestFile), manifest.output.file)) {
    throw new Error(`Refusing to overwrite the original video ${out}; choose another --out.`);
  }
  // The platform's bitrate (settings.video "H.264 10M, ..."), as in the first render.
  const videoBitrate = /^H\.264 (\d+(?:\.\d+)?[kKmM]),/.exec(String((manifest.settings as { video?: string }).video ?? ""))?.[1] ?? null;
  await renderLyricVideo({ props: manifest.props, media: verification.media, outFile: out, concurrency: options.concurrency, videoBitrate, log, onProgress: options.onProgress });
  return { out, notes: verification.notes, manifest };
}
