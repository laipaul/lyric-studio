// "Make another": before a take is queued, plan it (a dry plan, no render) next to the takes the song already has
// for that platform. A take that would make the same picture as one of them (same shots, cuts, clips, parts of the
// clips, look and lyric timing) is refused, saying why and which creative change would help, instead of
// rendering a duplicate.
import { existsSync } from "node:fs";

import type { Workspace } from "@lyric/db";

import { songRuns } from "./exports";
import { makeVideos } from "./make";
import { songPathsById } from "./song-folder";

// The takes (v2, v3, ...) of a platform that are made already and not discarded; "Try other looks" videos are not takes.
export function existingTakes(ws: Workspace, projectId: string, platform: string): number[] {
  const found = new Set<number>();
  for (const run of songRuns(ws, projectId)) {
    for (const p of run.platforms.filter((x) => x.name === platform)) {
      for (const v of p.videos) {
        const n = /^v(\d+)$/.exec(v.name)?.[1];
        if (n && !v.try && v.mark.status !== "discarded") found.add(Number(n));
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

// null: the take is fine (or cannot be compared: then Make says what is wrong itself). Else the message for the user.
export async function takeProblem(ws: Workspace, projectId: string, platform: string, take: number): Promise<string | null> {
  if (take < 2) return null;
  const others = existingTakes(ws, projectId, platform).filter((n) => n !== take);
  if (!others.length) return null;
  const paths = songPathsById(ws, projectId);
  if (!paths.audio || !existsSync(paths.audio) || !existsSync(paths.lyricsTxt)) return null;
  try {
    const result = await makeVideos({
      workspaceDir: ws.dir, song: paths.audio, lyrics: paths.lyricsTxt, ...(paths.hints && existsSync(paths.hints) ? { hint: paths.hints } : {}),
      platforms: platform, takes: [...others, take], dryRun: true, frameCheck: false, log: () => {},
    });
    const plan = result.platforms[0]?.plan;
    if (!plan || result.platforms[0]?.error) return null;
    const key = (name: string) => {
      const v = plan.videos.find((x) => x.spec.name === name);
      // The cover's slow sideways drift (a seeded few percent) is not a visible difference between two takes.
      return v ? JSON.stringify({ ...v.props, cover: v.props.cover ? { ...v.props.cover, drift: undefined } : v.props.cover }) : null;
    };
    const mine = key(`v${take}`);
    if (mine === null) return null;
    const same = others.find((n) => key(`v${n}`) === mine);
    if (same === undefined) return null;
    const cover = (plan.videos.find((x) => x.spec.name === `v${take}`)?.props as { layout?: string } | undefined)?.layout === "cover";
    const hint = cover
      ? "choose another look (Shape → Look bar → Change) or another cover picture"
      : "choose another look (Shape → Look bar → Change), add another clip or photo, or set a clip's best moment or length in Shape";
    return `Take ${take} would be identical to v${same}: change a setting in Shape first (e.g. ${hint}).`;
  } catch {
    return null; // the plan could not be made: the run itself says why
  }
}
