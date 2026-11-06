# Theme Engine v2 on HyperFrames — plan for review

_Written 6 Nov 2026 after the spike was adopted. A plan only: nothing here is built yet. Each step below is its
own session (plan first, Paul tests, stop). It goes with the spec "Videomaker — Theme Engine v2 Specification"
(Claude Docs, https://claude.ai/artifact/Y3MPZSg6dpiocMWKGAVQG5) and replaces nothing in it: the spec says what
a Theme is, this plan says how it gets drawn._

**Decision (6 Nov 2026): HyperFrames is adopted as the lyric renderer.** "Here with Me", first chorus, on Paul's
PC (RTX 5060, 32 GB): 9:16 in 72.3 s vs 81.3 s with Remotion (11% faster), 16:9 in 89.7 s, sync mean ~25 ms
(under one frame at 30 fps). Paul: "lyrics spot on."

## 1. "break." at 0.77 s, shown 200 ms early

**Conclusion: almost certainly an artefact of the spike's section start, not a sync error.** Confirm it in step 0.

Why:
- -200 ms is exactly the edge of the sync check's window (±6 frames = ±200 ms around each word). The check takes
  the brightest frame in that window as "lands here"; when the brightest frame is the first one, it means the
  spot was already lit when the window opened, not that the word came in exactly 200 ms early. A real early
  reveal would give any value, not exactly the window's edge.
- 0.77 s is inside the first second of the segment. The spike chooses its own section (one bar before the first
  hook line) and passes it as a fixed section, which bypasses the app's rule that a section never starts inside
  a sung line. So the line ending in "break." was already being sung when the segment starts: its earlier words
  landed before frame 0, and the line is clamped to start at 0 (the template fades the whole line in over its
  first 0.25 s, then "break." lands). Something else in that spot (the line's own fade-in, its neighbours' glow,
  or the line before it leaving) is brighter at 0.57 s than "break." is when it lands.
- In the cloud fixture every word that lands inside the segment measured 0 ms; the one word sung before the
  segment start was the only bad value (the same kind of boundary).

How we confirm (step 0, one command on Paul's PC): the spike prints, for "break.", the word's brightness frame by
frame and its opacity in the theme's own timeline from 0.4 s to 1.1 s. Expected: opacity 0 until 0.55 s, 1 at
0.77 s; the bright early frames come from the line around it.

Fixes (all three, small):
1. **Section start:** the spike (and later the engine) uses the planner's own section choice, which never starts
   inside a sung line (it moves back to the bar before that line). No line is ever "carried in" at frame 0.
2. **Lines already on screen at frame 0** (possible on a fixed section the user typed): drawn fully settled from
   frame 0, words sung before the start already shown, no fade-in. This matches how the current renderer opens.
3. **The sync check** measures in the theme's timeline (exact) and uses the pixels only to confirm the render
   matches it; a brightest frame on the window's edge is reported as "not measurable", never as early or late.

## 2. Integration: HyperFrames behind the same plan

**Principle:** nothing above the renderer changes. The planner (lyric timing, beat cuts, sections, endings,
pacing, anchors, textboard, QA, assessment) keeps producing the same props it gives Remotion today. A new
**compiler** turns those props into a HyperFrames composition (HTML + GSAP). The props stay the contract, so
manifests, Storyboard, QA and "dry run = render" keep working, and old manifests still render.

**Seam:** a renderer choice per run (`renderer: "hyperframes" | "remotion"`, default Remotion until step 3,
then HyperFrames). The compiler knows which props features it supports. If a video uses one it does not support
yet, that video is rendered by Remotion and the plan says so in plain words ("rendered with the current renderer:
dissolves are not on HyperFrames yet"): never a silently different video. The manifest records the renderer.

**Decision D1 (measured in step 1, Paul decides): what HyperFrames draws.**
- (a) **Lyrics only** (as the spike): HyperFrames draws the transparent text layer, FFmpeg builds the picture
  (clips, dissolves, dips, grade, Ken Burns) and lays the text over it. Fast, uses the GPU for the final encode.
  But the Storyboard and Shape previews would have to combine two systems to stay identical to the render.
- (b) **Everything in one composition** (clips as video elements inside HyperFrames): preview and render are
  the same file by construction (our hard rule), one system to maintain.
- Recommendation: (b) if it is within ~20% of (a)'s speed on Paul's PC, else (a) with a preview that plays the
  same two layers. Both are measured on "Here with Me" in step 1.

### Feature by feature: how each moves

| Feature today (Remotion) | How it moves to HyperFrames | Step |
| --- | --- | --- |
| Clips: trim, speed 0.5-1x, held last frame, cover crop | Video element with start and rate (b), or FFmpeg trim / setpts / tpad (a), as the spike's background | 2 |
| Photos with Ken Burns | Image with a GSAP zoom / pan from the same KenBurns numbers | 2 |
| Fill (vertical clip on 16:9 over a blurred copy) | Two layers, the blurred copy pre-made once by FFmpeg (as the cover background today) | 2 |
| Dissolves and dips to black (automatic transitions) | Opacity crossfade / black layer on the same frames the plan gives (props.dissolve, props.dips) | 2 |
| Reels loop ending (last shot continues the first clip), loopInto | The planner already decides it; the compiler draws the given frames | 2 |
| Song audio with fades only at cuts | Unchanged rule: the song cut by FFmpeg (as the spike), never processed; QA "Audio matches the song" unchanged | 2 |
| Theme picture: grade, vignette, text backing, fallback background | Grade: one FFmpeg/LUT pass on the clips (a) or CSS filter on the video layer (b); vignette and backing as HTML layers | 3 |
| Cinematic bars, lyric readability band, grain, beat glow | HTML layers, GSAP on the given beat frames | 3 |
| Lyric layout: one / two balanced lines, shrink up to 25%, three as last resort | Same layout function (pure, already measures with the font files) run by the compiler; Chrome draws the given lines | 2 |
| Line timing: lead 0.25 s, gap hiding, lead-in after gaps, next line waiting, glide stacking | The scene timeline (effects/scene.ts) already computes this per frame from props; the compiler turns it into GSAP tweens on the same frames | 2 |
| Lyric effects (glide, cinematic-fade, soft-blur, dreamy-glow, word-reveal, karaoke-highlight, floating, typewriter + erase + words, spread, clarify, ascend, ink, word-pop, highlight-sweep, mask-reveal, tilt-3d, glitch, wave, echo-stack, slice, kinetic-stack) | Each effect module keeps its numbers (durations, eases, amounts); a GSAP version per effect, checked frame by frame against the current renderer on test lines before it is switched on | 4-5 (common first: glide, karaoke-highlight, cinematic-fade, typewriter, soft-blur, word-reveal) |
| Add-ons: breathe, held-note glow, chorus lift, shine, emphasis word, hook scale | GSAP add-ons on the same frames | 5 |
| Textboard: per-line cards (place, size, hold, effect, font) | Same props, the compiler applies them | 4 |
| Title / byline / tagline cards, hook card, end card (typewriter, ascend, ink, spread) | HTML cards from the same props, effects as above | 4 |
| YouTube cover layout (drift, parallax), stills layout, mood veils, logo, end-screen area | HTML layers with GSAP on the given numbers | 6 |
| Spotify Canvas (loop blend, no text, no audio) | Clip layer + loop blend only | 6 |
| YouTube thumbnail (1280x720) | HyperFrames still frame of a thumbnail composition | 6 |
| Studio previews (Storyboard, Shape viewer, Style "Set effect", Pairings, Look preview, /preview page) | `@hyperframes/player` playing the same compiled composition | 7 |
| Effects grid (`pnpm effects:preview`), PairPreview | Compiled from the same effect code | 7 |
| `pnpm rerender` of old manifests | Old props compiled by the HyperFrames compiler; the note says "made with Remotion, now drawn by HyperFrames" (not pixel-identical, never silently) | 8 |

**Rule while both exist:** every new visual feature is built on HyperFrames only; Remotion is frozen as the
fallback (bug fixes only). No feature is built twice.

**Parity gate before Remotion goes:** every row above switched on; the seven v1 Themes and three test Themes pass
the spec's regression check (five reference frames each, before / after); Paul approves "Here with Me" and two
more songs.

## 3. Licence: Remotion out before any commercial version

Remotion needs a paid company licence for organisations with 4 or more people; a commercial Videomaker would
pass that risk to its customers. The goal is **no Remotion code in a commercial build**.

What has to go (all in step 8): `remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler`,
`@remotion/layout-utils`, `@remotion/cli`, Remotion's own headless Chrome download, and the two small uses of
Remotion's `Easing` / `interpolate` in pure code (effects/types.ts, youtube.ts): replaced by our own easing
module, tested to give the same curves. Text measuring already uses the font files directly (fontkit), not
Remotion.

**Other licences to clear before a commercial installer** (a check in step 8, written into a LICENCES.md):
- **GSAP**: free since 2024 including commercial use, under Webflow's standard licence, which has conditions
  (for example about tools that compete with Webflow's visual builders). Needs a careful read for an app where
  users design animations. Fallback if it does not fit: HyperFrames also drives CSS / Web Animations and other
  runtimes; our compiler would emit those instead (the effects are our numbers, not GSAP's).
- **HyperFrames**: Apache-2.0 (fine); its telemetry stays off by default in our builds.
- **FFmpeg**: a build with x264 is GPL; a closed commercial installer needs an LGPL build (and NVENC / another
  H.264 encoder) or GPL compliance.
- **Chrome headless shell**: BSD-style (fine). **Fonts**: already tracked (fonts/LICENSES.md).

## 4. Three starter themes, rules, and Paul's notes as new rules

**The three themes** (the spec's test themes, built as HyperFrames templates driven by Theme v2 data):
1. **Life Lyrics cinematic ballad**: long holds, held-note glow, a final chorus that builds, restraint (1-2 peaks).
2. **Reel word-by-word ("Here With Me")**: typewriter, stacked 2-4 short lines with build-up, dissolve pacing,
   title card (title, "by Life Lyrics", the Japanese tagline, credits), the same picture opening and closing,
   a bigger final hook. Acceptance: the spec's golden test, generated next to the original Reel; passes when
   Paul would publish it.
3. **Pômé urban**: a second Brand Kit, French typography and accents.

**theme-rules.md** (docs/theme-rules.md): the rule book in plain words, one entry per rule. Each entry has an id
(e.g. `TIM-03`), the rule ("a line is on screen at least 1.0 s"), why (the pro practice behind it), the value
and where it lives (craft-rules.json for Craft Rules, a theme's rules block for theme behaviour), the test that
proves it, and the notes it came from. It starts with the spec's Craft Rules plus pro lyric-video practice the
app already follows (lead 0.25 s, gap hiding, reading speed, no text change on a cut frame, safe zones, one
highlighted word per line, peaks per platform). The code reads the values; the md is the explanation.

**Feedback loop (Paul's timestamped notes become rules):**
1. **Note**: in the Videos tab's player, "Note at this moment" (the timestamp and video are filled in) with free
   text, e.g. "0:12.4 'tonight' lands late"; also allowed as a plain text file in the song folder
   (`reviews\<date>.md`, lines starting with a time).
2. **Triage** (a Claude session, Paul approves): each note becomes one of a timing fix for that song (not a rule),
   a theme value change (that theme only), or a new / changed rule (all themes).
3. **Rule**: written into theme-rules.md with the note's id, the value into craft-rules.json or the theme, and a
   test built from the note's moment (that frame, before and after) so it never comes back.
4. **Report**: the next render's assessment says what the rule did ("Done for you: …"); the note is marked done.

## 5. Phases, effort, risks

One step = one session (plan, build, test in the cloud, Paul tests on the PC). Rough sizes: S ≈ half a session,
M ≈ one, L ≈ two.

| Step | What | Size |
| --- | --- | --- |
| 0 | Fix and confirm "break." (section start, carried-in lines, sync check); spike re-run on "Here with Me" | S |
| 1 | Compiler skeleton + renderer seam + fallback; measure D1 (lyrics-only vs everything) on Paul's PC; Paul decides | M |
| 2 | Picture and basics: clips, photos, fill, dissolves, dips, loop ending, audio, layout, line timing, glide | L |
| — | Spec T1-T4 (section tags, v2 schema + adapter, rule engine, Craft Rules + theme-rules.md): data only, renderer-free, can go here | 4 × M |
| 3 | Theme picture: grade, vignette, backing, bars, grain, glow; HyperFrames becomes the default renderer | M |
| 4 | Textboard cards, title / hook / end cards, the most used effects | L |
| 5 | The other effects and add-ons, each checked against the current renderer | L |
| 6 | YouTube layouts, Canvas, thumbnail | M |
| 7 | Studio previews on `@hyperframes/player`; effects grid | L |
| — | Three starter themes (spec T5-T7, T9 golden test) + the notes loop | 3 × M + M |
| 8 | Parity gate, remove Remotion, easing module, rerender of old manifests, licence check, installer notes | M |

About 20 sessions in total, plus Paul's test passes. Order: 0 → 1 → T1-T4 → 2 → 3 → 4 → 5 → three themes → 6 → 7 → 8
(the themes need 2-5; YouTube / Canvas / previews can follow the themes).

**Risks**
- **HyperFrames is young** (0.9.x, releases almost daily, by HeyGen): pin the version, upgrade on purpose with the
  regression frames; our compiler keeps it behind one seam; Apache-2.0 allows a fork if needed.
- **Speed on heavy effects**: the spike measured one effect. Each effect group is timed on Paul's PC when it is
  switched on; a big slowdown is reported before it becomes the default.
- **Two renderers at once** (steps 1-8): double maintenance and the "preview = render" rule. Mitigation:
  Remotion frozen, the fallback is explicit per video, the parity gate is fixed in advance.
- **Determinism**: pin the Chrome version HyperFrames uses; fonts already come as exact files.
- **Licences**: GSAP terms and the FFmpeg build must be cleared before a commercial version (section 3).
- **Windows**: Node 22 is now required (done on Paul's PC); a one-off installer later bundles Node, Chrome and
  FFmpeg (spike README).
- **Visual drift**: effects ported to GSAP look slightly different; each one is compared frame by frame and
  approved, not assumed.
