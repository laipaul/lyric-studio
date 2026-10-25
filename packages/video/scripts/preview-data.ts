// Prints the data the studio's /preview page needs (render:test defaults) as JSON on stdout.
// Progress messages go to stderr. Used by apps/studio (src/lib/preview-data.ts).
import { DEFAULT_SEED, prepareRender } from "../src/node";

try {
  const { base, effects, media, report, setupWarnings } = await prepareRender({ log: (m) => console.error(`[preview] ${m}`) });
  console.log(
    JSON.stringify({
      base,
      effects,
      media,
      defaultSeed: DEFAULT_SEED,
      setupWarnings,
      report: {
        song: report.song,
        bpm: report.bpm,
        downbeatConfidence: report.downbeatConfidence,
        requestedSection: report.requestedSection,
        section: report.section,
        cuts: report.plan.cuts.length,
        clipCount: report.clipCount,
        lyricLines: report.lyricLines,
      },
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ error: (error as Error).message }));
}
