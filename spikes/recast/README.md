# Recast spike: your main character in place of the person in each clip

Which method puts **Bride No 2** best into Midjourney clips that show other women? This folder answers that **without
touching the app**. It reads the song's Storyboard and the character's card through the app's own code and writes only
into `workspace\recast\<song>\<date-time>\`. The clips, the song and the card are never changed.

| | Method | What it does |
|---|---|---|
| A | **Wan 2.2 Animate Replace** (`fal-ai/wan/v2.2-14b/animate/replace`) | Replaces the person in the clip with the person in the picture. 720p (480p with `--quality draft`). |
| B | **MiniMax H3 Max Recast** (`minimax/h3-max/recast` or `fal-ai/minimax-h3-max-recast`) | Recasts the main person from reference photos. Its lower resolution (768P) unless `--quality high`. |
| C | **Keyframe + Seedance** | The clip's first frame → its depth map → a new first frame with the character in the **same layout** (Seedream 4.5, depth-guided, with the close-up, 3/4 face and reference picture) → **Seedance reference video-to-video** with the original clip as the motion reference and the new frame as the first frame. Draft 480p. |
| D | Runway Aleph | Stub: skipped (no Runway key yet). |
| E | Higgsfield Genjutsu | Stub: the adapter slot is ready. |

Pictures sent: the character's **close-up, 3/4 face and reference picture** of its latest locked version. Never the
full-body views.

## Run it

Your fal key must be in `D:\videomaker\.env` (`FAL_KEY=…`). `.env` is in `.gitignore`, and the key is never printed or saved.

**1. See what fal says about each endpoint** (free; nothing is sent):

```
cd D:\videomaker
pnpm recast check
```

It lists each method's endpoint, its price per second or picture, and its input fields. The spike builds every request
from these fields, never from a guess. If a method says **NOT FOUND**, tell me what it printed. You can also name
another ID: `--seedance <endpoint id>` or `--h3 <endpoint id>`.

**2. The Storyboard cards with their numbers:**

```
pnpm recast "Wedding Day" --list
```

**3. The estimate** (nothing is uploaded):

```
pnpm recast "Wedding Day" --character "Bride No 2" --clips 7,9,10 --keyframe-clips 7 --max-cost 10
```

**4. Send it:** the same command with `--yes` at the end.

| Option | Meaning |
|---|---|
| `--clips 7,9,10` | The numbers on the Storyboard cards (as `--list` shows them), clip file names, or `all`. |
| `--methods wan,h3,keyframe` | Which methods: names or letters (A–E). The default is A, B and C. |
| `--keyframe-clips 7` | C only on these cards (the first run: the close-up). |
| `--quality draft\|high` | A and B both at their lower (draft) or higher resolution. The default is A 720p, B 768P. C is always 480p. |
| `--max-cost 10` | Safety cap in dollars (default 3). Above it nothing is uploaded, even with `--yes`. |
| `--card-version 1` | Use this version of the card (default: the latest locked one). |
| `--parallel 3` | Jobs running at the same time (default 3). |
| `--timeout-min 20` | Per request. A failed or timed-out request is tried once more. |

If a result ran on fal but did not download (a dropped connection), get it later for free:

```
pnpm recast fetch "D:\videomaker\workspace\recast\Wedding Day\2026-11-18_2130"
```

## What you get

In `workspace\recast\<song>\<date-time>\`:

- `comparison.mp4`: every clip one after another, each as **Original | A | B | C** side by side, labelled.
- `report.md`: per clip and method, a verdict in plain words ("Ready to use" / "Good — one thing to improve: …" /
  "Not usable yet: …"), the face, scene and motion checks, cost and time, and the fal request IDs.
- `report.json`: the same, in full.
- Per clip, a folder `07_<clip>`:
  - `original.mp4` (the copy that was sent);
  - each result fitted back to the clip's exact size, frame rate and length (`A_wan.mp4`, `B_h3.mp4`, `C_keyframe.mp4`);
  - fal's own video (`*_raw.mp4`);
  - for C, `first_frame.png`, `depth.png` and `keyframe.png`.

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
