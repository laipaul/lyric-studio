# Recast spike: your main character in place of the person in each clip

Which method puts **Bride No 2** best into Midjourney clips that show other women? This folder answers that **without
touching the app**. It reads the song's Storyboard and the character's card through the app's own code and writes only
into `workspace\recast\<song>\<date-time>\`. The clips, the song and the card are never changed.

| | Method | What it does |
|---|---|---|
| A | **Wan 2.2 Animate Replace** (`fal-ai/wan/v2.2-14b/animate/replace`) | Replaces the person in the clip with the person in the **close-up**. The clip is **padded to 9:16** first (see below). 720p (480p with `--quality draft`). The known-weak baseline. |
| B | **MiniMax H3 Max Recast** (`minimax/h3-max/recast`) | Recasts the main person. It takes **one photo per new person**, so it gets exactly **one**: the close-up (three photos would mean three new people). With `enhance_realism`. 1080P (768P with `--quality draft`). Needs a clip of **at least 5 s**. |
| C | **Keyframe + Kling** | The clip's first frame → a **new first frame** with the character in the same layout (`--keyframe-model`, default Nano Banana Pro; image 1 = the frame, 2 = the close-up, 3 = the 3/4 face) → a **free face check** → **Kling O1 video edit** with the original clip (scaled up to at least 720 px), the character as `@Element1` (close-up, 3/4 face, reference picture) and the new frame as `@Image1`. A clip of **3 to 10 s**. |
| F | **Keyframe + Wan** | The same new first frame (made **once** when C and F both run, counted once in the cost) and the same face check → **Wan 2.2 Animate Replace** with the new frame as its picture, padded to 9:16 like the clip. 720p (480p with `--quality draft`). |
| D | Runway Aleph | Stub: skipped (no Runway key yet). |
| E | Higgsfield Genjutsu | Stub: the adapter slot is ready. |

Seedance is not in the list any more: fal refuses it for real people ("likenesses of real people … cannot be processed"),
a safety rule of the model that we do not try to get around.

**The new first frame is checked before any video is paid for.** After the picture model answers, the local face check
compares the new frame with the character's close-up and with the original frame (free). If the face is closer to the
original person than to the character, or no face is found, or the character is below the card's red line, the spike
tries **once more with a new seed** (if the cap allows). If it still fails, that clip's C and F stop with *"The new first
frame still shows the original person (…): the video step was not sent."* and nothing more is spent on them. Both scores
of every try are in `report.md` and `report.json`.

**Padding (A and F).** Wan crops to 9:16, so the clip is centred on a black 9:16 canvas first (a 544×720 clip becomes
544×968; a clip taller than 9:16 gets bars left and right instead). After download the video is scaled to the canvas and
exactly the clip's own rectangle is cut out again: the padding is removed and nothing of the picture is lost. The report
says "padding removed".

Pictures sent: the character's **close-up, 3/4 face and reference picture** of its latest locked version. Never the
full-body views. A, B and F get the close-up (F: the new frame); C gets all three.

## Prices (printed per line, with their source, before anything is uploaded)

| Step | Price |
|---|---|
| Wan (A, F) | $0.04 / $0.06 / $0.08 per video second at 480 / 580 / 720p; video seconds = frames ÷ 16 (24 fps counts ×1.5). |
| H3 (B) | $0.085 per output second at 768P, $0.17 at 1080P (5 s minimum) + $0.022 per 1,000 input tokens after the first 4,096 (1 s of video ≈ 6,750 tokens). 5.21 s at 1080P ≈ $1.57. |
| Kling (C) | $0.168 per second of video. |
| New first frame | Seedream 4.5 $0.04, Nano Banana Pro $0.15 (default), GPT Image 1.5 about $0.24. |

Each line says where the number comes from: **fal's price list**, **fal docs, 18 Nov 2026** (the documented formulas,
used first where the price depends on resolution, frames or tokens, and where fal's list has no entry), or **not
confirmed**. If a price cannot be computed at all, the run stops before uploading: *"Cannot estimate …: nothing was
uploaded."* The spike never guesses a unit.

## Run it

Your fal key must be in `D:\videomaker\.env` (`FAL_KEY=…`). `.env` is in `.gitignore`, and the key is never printed or saved.

**1. See what fal says about each endpoint** (free; nothing is sent):

```
cd D:\videomaker
pnpm recast check
```

It lists each method's endpoint, its price per second or picture, and its input fields. The spike builds every request
from these fields, never from a guess. If a method says **NOT FOUND**, tell me what it printed. You can also name
another ID for B: `--h3 <endpoint id>`.

**2. The Storyboard cards with their numbers:**

```
pnpm recast "Wedding Day" --list
```

**3. First step: only the new first frames** (a few cents per clip; look at `keyframe.png` before any video is sent):

```
cd D:\videomaker
pnpm recast "Wedding Day" --character "Bride No 2" --clips 7,9,10 --keyframe-only --max-cost 1
```

Without `--yes` it only prints the estimate; add `--yes` to send. Each clip's folder then has `first_frame.png`
(the original) and `keyframe.png` (the character in its place) with the two face scores in `report.md`.

**4. The recommended video run** (one clip, the three methods that have a chance):

```
cd D:\videomaker
pnpm recast "Wedding Day" --character "Bride No 2" --clips 10 --methods h3,keyframe,kwan --max-cost 3.5
```

A is the known-weak baseline; add it with `--methods wan,h3,keyframe,kwan`. For a 5.21 s clip of 544×720 at 24 fps the
estimate is B $1.57 · C $1.03 (first frame $0.15 + Kling $0.88) · F $0.63 (the first frame is counted once) = $3.23.
Send it: the same command with `--yes` at the end.

| Option | Meaning |
|---|---|
| `--clips 7,9,10` (on PowerShell either `--clips 7,9,10` or `--clips "7,9,10"` works) | The numbers on the Storyboard cards (as `--list` shows them), clip file names, or `all`. |
| `--methods h3,keyframe,kwan` | Which methods: names or letters (A–F). The default is A, B, C and F. |
| `--keyframe-clips 7` | C **and** F only on these cards. |
| `--keyframe-model seedream\|nano-pro\|gpt` | The picture model for the new first frame (default `nano-pro`). |
| `--keyframe-only` | Only make the new first frames (with the face check); no video is sent. |
| `--quality draft\|high` | Draft: Wan 480p, H3 768P. High (default): Wan 720p, H3 1080P. |
| `--max-cost 3.5` | Safety cap in dollars (default 3). Above it nothing is uploaded, even with `--yes`. |
| `--card-version 1` | Use this version of the card (default: the latest locked one). |
| `--parallel 3` | Jobs running at the same time (default 3). |
| `--timeout-min 20` | Per request. A failed or timed-out request is tried once more. |

If a result ran on fal but did not download (a dropped connection), get it later for free:

```
pnpm recast fetch "D:\videomaker\workspace\recast\Wedding Day\2026-11-18_2130"
```

## What you get

In `workspace\recast\<song>\<date-time>\`:

- `comparison.mp4`: every clip one after another, each as **Original | A | B | C | F** side by side, labelled.
- `report.md` (saved with a byte-order mark, so Windows PowerShell's `Get-Content` shows ✓ × → – correctly): per clip and method, a verdict in plain words ("Ready to use" / "Good — one thing to improve: …" /
  "Not usable yet: …"), the face, scene and motion checks, cost and time, and the fal request IDs.
- `report.json`: the same, in full.
- Per clip, a folder `07_<clip>`:
  - `original.mp4` (the copy that was sent);
  - each result fitted back to the clip's exact size, frame rate and length (`A_wan.mp4`, `B_h3.mp4`, `C_keyframe.mp4`, `F_kwan.mp4`);
  - fal's own video (`*_raw.mp4`);
  - the copies that were sent (`padded_916.mp4`, `kling_720.mp4`);
  - for C and F, `first_frame.png`, `keyframe.png` (and `keyframe_pad916.png`).

## The checks (local, free)

1. **Face:** every 0.5 s, each face in the result is compared with the character's three pictures (SFace). You get:
   - the share of frames that match;
   - the weakest moment;
   - a warning when the **original person's face is still visible**.
2. **Scene kept:** the people are masked out of the original and the result (MediaPipe pose segmentation plus the face
   areas), and the backgrounds are compared on structure (SSIM) and colour (histogram). A low score gives **"Repainted
   scene"**.
3. **Motion kept:** the body pose (normalised to the body's size) and the movement in the picture (optical flow over
   0.1 s, compared cell by cell) of the original and the result.

The thresholds are first guesses. `report.json` keeps every number, so we can tune them on your real results.

## Tests

```
pnpm recast:test
```

These tests use stand-ins for fal and the judge, so no network and no key are needed. The judge's own tests:
`services\audio\.venv\Scripts\python -m pytest services\audio\tests\test_recast_judge.py`.
