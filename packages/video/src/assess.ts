// The pro assessment (guiding principle): one verdict per video, like a senior editor's notes after
// watching it, instead of a list of technical checks.
//   ready      ✅ Ready to post: nothing a viewer would notice;
//   good       🟡 Good, could be better: up to a few things a viewer may notice, each with the creative
//              action that fixes it;
//   not-ready  🔴 Not ready: something clearly wrong (a sung line cut, lyrics under the platform's buttons,
//              a black flash, music that does not match the song, ...).
// Built from the QA checks (v<N>.qa.txt) and the manifest (shots, the app's decisions); the technical
// details stay one click away. It learns: a point the user approved videos with at least twice (same
// code) stops lowering the verdict ("you usually accept this").
// Pure (the studio's server and the Storyboard's prediction use it).

export type Verdict = "ready" | "good" | "not-ready";
export type AssessPoint = { code: string; major: boolean; text: string; action: string };
export type Assessment = {
  verdict: Verdict;
  headline: string;
  points: AssessPoint[]; // the ones that count, majors first
  accepted: AssessPoint[]; // minor points the user usually accepts (not counted)
  handled: string[]; // what the app decided by itself (pacing, transitions, ending), in plain words
  prediction: boolean; // from the plan (Storyboard), before rendering
};

export const ACCEPT_AFTER = 2; // approved this many times with the same point: it no longer counts
export const SLOW_MOTION_RATE = 0.75;

type Problem = { check: string; details: string[] };
type ShotInfo = { start_s: number; speed: number; hold: boolean; photo: boolean };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const quote = (t: string) => `“${t}”`;
const LISTEN = 'Listen to it in the Lyrics tab (▶), then nudge it or mark it "Checked by ear".';
const AGAIN = "Make it again; if it happens again, tell Claude (this is the app's job, not your clips).";

// "line 22 "Friends are a good thing": ..." -> { n: 22, text: "Friends are a good thing", rest }
function lineOf(detail: string): { n: number; text: string; rest: string } | null {
  const m = /^line (\d+) "([^"]*)"(.*)$/.exec(detail);
  return m ? { n: Number(m[1]), text: m[2], rest: m[3] } : null;
}

function pointsFor(p: Problem): AssessPoint[] {
  const minor = (code: string, text: string, action: string): AssessPoint => ({ code, major: false, text, action });
  const major = (code: string, text: string, action: string): AssessPoint => ({ code, major: true, text, action });
  const lines = (fn: (l: { n: number; text: string; rest: string }) => AssessPoint | null) =>
    p.details.map(lineOf).filter((l): l is NonNullable<ReturnType<typeof lineOf>> => !!l && !/checked by ear/.test(l.rest)).map(fn).filter((x): x is AssessPoint => !!x);
  switch (p.check) {
    case "Lyric timing confidence":
      return lines((l) => minor(`timing:${l.n}`, `Line ${l.n} ${quote(l.text)} may be slightly off the singing.`, LISTEN));
    case "Lines start with the vocals":
      return lines((l) => {
        const s = /\(([\d.]+) s early\)/.exec(l.rest)?.[1];
        return minor(`early:${l.n}`, `Line ${l.n} ${quote(l.text)} appears ${s ? `${s} s ` : ""}before it is sung.`, LISTEN);
      });
    case "Line starts to review":
      return lines((l) => minor(`review:${l.n}`, `Line ${l.n} ${quote(l.text)} may start a little early or late (the app was not sure).`, LISTEN));
    case "Audio matches the song":
      return [major("audio", "The music in the video does not match the song exactly.", AGAIN)];
    case "Clips repeated within 3 shots": {
      const reps = p.details.filter((d) => /^shot \d+/.test(d));
      const first = /^shot \d+ \((\d+:\d+\.\d)\) repeats (\S+)/.exec(reps[0] ?? "");
      return [
        minor(
          "repeat",
          `The same clip comes back within a few seconds${(() => {
            const where = first ? `${first[2]} at ${first[1].replace(/\.\d$/, "")}` : "";
            const parts = [reps.length > 1 ? `${reps.length} times` : "", where ? `${reps.length > 1 ? "e.g. " : ""}${where}` : ""].filter(Boolean);
            return parts.length ? ` (${parts.join(", ")})` : "";
          })()}.`,
          "Add a clip or two to the song, or change the story order in the Storyboard.",
        ),
      ];
    }
    case "Black or frozen frames": {
      const out: AssessPoint[] = [];
      for (const d of p.details) {
        const black = /^black (\d+:\d+\.\d)/.exec(d);
        if (black) out.push(major(`black:${black[1]}`, `A black flash at ${black[1].replace(/\.\d$/, "")}.`, AGAIN));
        const held = /^frozen (\d+:\d+\.\d).*holds the last frame of (\S+)/.exec(d);
        if (held) out.push(minor(`freeze:${held[2]}`, `The picture freezes at ${held[1].replace(/\.\d$/, "")}: ${held[2]} is too short for its shot.`, `Use a longer clip there, or give ${held[2]} a longer part in the clip editor.`));
        else {
          const still = /^frozen (\d+:\d+\.\d)-\S+ \(([\d.]+) s\)$/.exec(d);
          if (still) out.push(minor(`still:${still[1]}`, `The picture stands still for ${still[2]} s at ${still[1].replace(/\.\d$/, "")}.`, "Fine if the clip is meant to be still; otherwise choose a livelier clip for that moment."));
        }
      }
      return out;
    }
    case "Lyric lines over 2 lines":
      return lines((l) => minor(`wrap:${l.n}`, `Line ${l.n} ${quote(l.text)} needs 3 lines on a phone screen.`, "Split it into two lines in lyrics.txt (Lyrics tab)."));
    case "Shots under 0.8 s":
      return [minor("short-shot", "A very short shot may feel like a flicker.", "Nothing to do for you: if it keeps happening, tell Claude (pacing is the app's job).")];
    case "Lyrics inside the safe zone":
      return lines((l) => major(`safe:${l.n}`, `Line ${l.n} ${quote(l.text)} reaches under the platform's buttons or captions.`, `Shorten line ${l.n} or split it in lyrics.txt.`));
    case "Video length":
      return [major("length", "The file does not have the length it should.", AGAIN)];
    case "Story anchors":
      return [minor("anchors", `Not every anchor could be placed as asked: ${p.details[0] ?? "see the details"}.`, "Check the anchored lines in the Storyboard (⚓).")];
    case "Loop flows":
      return p.details.map((d) =>
        /both show (\S+)/.test(d)
          ? minor("loop-picture", `The loop is visible: ${/both show (\S+)/.exec(d)![1]} opens and closes the video.`, "Move that clip in the story order (Storyboard).")
          : minor(`loop:${d.split(/[ :(]/)[0]}`, `The jump back to the start may be noticeable (${d.split(":")[0]}).`, "Try one of the target lengths the Storyboard suggests."),
      );
    case "Seamless loop":
      return [major("canvas-loop", "The Canvas loop shows a visible jump.", "Choose another clip for the Canvas (clip editor → Use for Canvas).")];
    case "No audio":
      return [major("canvas-audio", "The Canvas has sound (Spotify needs it silent).", AGAIN)];
    case "Logo clear of the lyrics":
      return [minor("logo-lyrics", "The logo touches a lyric line.", "Choose another logo corner in brand.json (logo.youtube).")];
    case "Logo in a frame corner":
      return [minor("logo-corner", "The logo is not in a frame corner.", "Choose a corner in brand.json.")];
    case "End-screen area clear":
      return [minor("end-screen", "A lyric line reaches into YouTube's end-screen area in the last seconds.", AGAIN)];
    case "Section start/end":
      return p.details.map((d) => {
        const m = /^the video (starts|ends) at (\S+) .* line (\d+) "([^"]*)"/.exec(d);
        return major(`cut:${m?.[3] ?? d}`, m ? `The video ${m[1]} while line ${m[3]} ${quote(m[4])} is being sung.` : "A sung line is cut at the start or end.", "Choose another target length in the Style tab, or Section: auto.");
      });
    default:
      if (p.check.startsWith("Length ")) return [major("canvas-length", `The Canvas loop has the wrong length (${p.details[0] ?? ""}).`, AGAIN)];
      if (p.check === "Length for the platform") return [major("platform-length", `Too long for the platform: ${p.details[0]?.split(" (")[0] ?? ""}.`, "Choose a shorter section, or Section: auto.")];
      if (p.check === "Sources for this format") {
        const m = /only (\d+) (\S+) source\(s\) for (.+?); at least (\d+) needed/.exec(p.details[0] ?? "");
        return [minor("sources", m ? `Only ${m[1]} ${m[2]} clips for ${m[3]}, so some repeat close together.` : "Few clips suit this format.", m ? `Add ${Number(m[4]) - Number(m[1])} more ${m[2]} clip(s).` : "Add more clips in the right orientation.")];
      }
      return [minor(p.check.toLowerCase(), `${p.check}: ${p.details[0] ?? ""}`, "See the technical checks.")];
  }
}

export function assessVideo(o: {
  problems: readonly Problem[]; // the QA checks that warned (or, for a prediction, the plan's)
  shots?: readonly ShotInfo[];
  decisions?: readonly string[]; // "Pacing: …", "Transitions: …", "Ending: …"
  canvas?: { seconds: number; possibleS: number; needClipS: number | null } | null;
  acceptedCodes?: Readonly<Record<string, number>>;
  prediction?: boolean;
}): Assessment {
  const all = o.problems.flatMap(pointsFor);
  const slow = (o.shots ?? []).filter((s) => !s.photo && !s.hold && s.speed < SLOW_MOTION_RATE - 1e-6);
  if (slow.length) all.push({ code: "slow-motion", major: false, text: `${slow.length === 1 ? "One shot plays" : `${slow.length} shots play`} in slow motion below 0.75x (from ${clock(slow[0].start_s)}) and may look choppy.`, action: "Give those clips a longer part in the clip editor, or add longer clips." });
  if (o.canvas && o.canvas.seconds < o.canvas.possibleS - 0.5) {
    all.push({
      code: "canvas-short",
      major: false,
      text: `The Canvas loop is only ${o.canvas.seconds.toFixed(1)} s (${o.canvas.possibleS.toFixed(1)} s is possible).`,
      action: o.canvas.needClipS ? `Add a vertical clip of at least ${Math.ceil(o.canvas.needClipS)} s (or pick one with "Use for Canvas").` : "Add a longer vertical clip.",
    });
  }
  // One point per code (the first), majors first.
  const seen = new Set<string>();
  const unique = all.filter((p) => !seen.has(p.code) && seen.add(p.code));
  const accepted = unique.filter((p) => !p.major && (o.acceptedCodes?.[p.code] ?? 0) >= ACCEPT_AFTER);
  const points = unique.filter((p) => !accepted.includes(p)).sort((a, b) => Number(b.major) - Number(a.major));
  const majors = points.filter((p) => p.major).length;
  const verdict: Verdict = majors ? "not-ready" : points.length ? "good" : "ready";
  const n = (k: number) => `${k} thing${k > 1 ? "s" : ""}`;
  const headline = verdict === "ready" ? "Ready to post" : verdict === "good" ? `Good — ${n(points.length)} to improve` : `Not ready — fix ${n(majors)} first`;
  return { verdict, headline: o.prediction ? `${headline} (prediction before rendering)` : headline, points, accepted, handled: [...(o.decisions ?? [])], prediction: !!o.prediction };
}

// The strongest of several videos of one platform (fewest problems, majors weigh most), with why.
export function strongest<T extends { name: string; assessment: Assessment }>(videos: readonly T[]): { name: string; why: string } | null {
  if (videos.length < 2) return null;
  const weight = (a: Assessment) => a.points.reduce((s, p) => s + (p.major ? 10 : 1), 0);
  const sorted = [...videos].sort((a, b) => weight(a.assessment) - weight(b.assessment));
  if (weight(sorted[0].assessment) === weight(sorted[1].assessment)) return null; // no clear winner
  const others = sorted.slice(1).map((v) => `${v.name}: ${v.assessment.points.length}`).join(", ");
  return { name: sorted[0].name, why: `${sorted[0].assessment.points.length ? `the fewest things to improve (${sorted[0].assessment.points.length})` : "nothing to improve"}; ${others}` };
}
