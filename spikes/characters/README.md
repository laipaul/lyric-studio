# Characters spike (C1): one picture in → reference check, character pack, location angles

Does "one picture in, consistent shots out" work for your look? This folder answers that **without touching the
app**:
- Nothing in `apps/` or `packages/` changes.
- It only reads the workspace, and opens the database **read-only** (only for `--song`), so the app can stay open.
- The face checks run on your PC: local, free, CPU only.

## Run it

First time only, install the fal client for this folder:

```
cd D:\videomaker\spikes\characters
npm install
cd D:\videomaker
```

The first `pnpm characters` run also installs the local face checks: `pnpm audio:setup --face`, which is MediaPipe +
OpenCV, about 120 MB. The face models (about 52 MB) download once into `services\audio\models\face\`. Your fal key
comes from `D:\videomaker\.env` (`FAL_KEY=…`; `.env` is in `.gitignore`, and the key is never printed).

```
pnpm characters calibrate --image "D:\pictures\bride.jpg" --song "Wedding Day" --name bride
pnpm characters pack --image "D:\pictures\bride.jpg" --scene "D:\pictures\bridal room.jpg" --name bride
pnpm characters pack --image "D:\pictures\bride.jpg" --scene "D:\pictures\bridal room.jpg" --name bride --max-cost 5 --yes
```

1. **`calibrate`** (free, local) sets the "same person" line for your character. It compares her face with:
   - the faces in other clips (`--song` = that song's clips folder, or `--others "<folder or files>"`);
   - changed copies of her own picture (mirrored, smaller, darker, tilted, compressed, blurred).

   Every clip counts as "another person" unless you mark it with `--her "<clip name>"` (repeatable; a part of the
   file name is enough, any case). A clip you did not mark that scores 0.6 or more is taken for the reference picture
   itself (or a copy) and left out. If her own clips score below the best other woman, the report says the check
   cannot tell them apart reliably (green = very likely her; otherwise check by eye). The thresholds are saved in `out\<name>\calibration.json`, and every pack run for that `--name`
   uses them.
2. **`pack`** runs the steps below. Without `--yes` it stops after the estimate (nothing uploaded).
   - The **reference check** of the picture (and of `--image2`), and the **location check** of `--scene`.
     "Not suitable" stops the run (`--force` to try anyway).
   - The **estimate** per model and the total. Above `--max-cost` (default $3) nothing is uploaded, even with `--yes`.
   - With `--yes`: per model, 4 views in a **neutral, empty outdoor setting in soft natural daylight** (a grey
     studio backdrop gave plastic skin): a **close-up face** (the identity source), a **3/4 face**, and a **full body
     from the front** and **from the back**, both **cropped at the neck**, so faces only ever come from the
     close-up. Then the 3 location angles (wide from the left, wide from the right, a closer detail). Your picture
     is sent as identity AND style reference.
   - The **face views** are face-checked against your picture: green = same person, amber = check by eye, red =
     drifted. A red view is **made again, at most twice** (a new seed), and the best try is kept. Retries stop at
     the cap. The **body views** get no face score: if a face shows up anyway (not cropped at the neck), the view
     is red and made again; otherwise judge the outfit and body by eye.
   - A **draft description** of her (and of the place), to edit before locking. It uses the cheapest vision model at
     $0.01 per call. `--ai-opinion` adds a paid opinion on the reference picture.
   - **Contact sheets**: `sheet_pack.jpg` (one row per model: your picture + the 4 views, the face views with their score and
     colour) and `sheet_location.jpg`.
   - **Report**: `report.md` (in plain words) and `report.json` (every try, its fal request ID and its score).
   - The **actual cost** comes from fal's Billing Events API, per request ID. This needs a key with billing
     permission (fal key presets BILLING or FULL). Without it the report says so, and fal.ai → Dashboard → Usage
     has it. fal can report a few minutes late: `pnpm characters cost "<run folder>"` asks again.
3. **`cost "<run folder>"`** fetches the actual cost again and updates the report.

| Option | Meaning |
|---|---|
| `--name bride` | The character's name (folder `out\bride\`). Default: the picture's file name. |
| `--models nano-pro,nano2,seedream,gpt` | Which image models (default all four). |
| `--her "<clip name>"` | calibrate: a clip that really is her (repeatable; a part of the file name is enough). Without it every clip counts as another person. |
| `--image2 "<path>"` | A second picture of her, sent as a second reference (one of the reference check's fixes). |
| `--crop` | Crop your picture to her face first (one of the fixes; the cropped copy is what gets sent). |
| `--ai-opinion` | A paid AI opinion on the reference picture ($0.01). |
| `--max-cost 3` | Safety cap in dollars, for the first try and for the retries. |
| `--force` | Generate even when the reference check says "Not suitable". |

The "upscale" fix is the separate upscale pass on the roadmap. For now, a larger picture works.

## The image models (fal.ai, checked 17 Nov 2026)

| Name | Endpoint | Price as fal lists it | Settings used |
|---|---|---|---|
| Nano Banana Pro | `fal-ai/nano-banana-pro/edit` | $0.15 per image | 2K (same price as 1K), aspect 3:4 / 2:3 |
| Nano Banana 2 | `fal-ai/nano-banana-2/edit` | $0.08 per image at 1K | 1K, aspect 3:4 / 2:3 |
| Seedream 4.5 | `fal-ai/bytedance/seedream/v4.5/edit` | $0.04 per image | 1920×2560 / 1920×2880 (its minimum is about 3.7 MP) |
| GPT Image 1.5 | `fal-ai/gpt-image-1.5/edit` | about $0.24 (high, 1024×1536, + input tokens) | high quality, high input fidelity |
| Descriptions | `fal-ai/any-llm/vision` (`google/gemini-2.5-flash-lite`) | $0.01 per call | |

All four models at once: 7 images each is about $3.59 for the first try, more with retries. So use `--max-cost 5`,
or fewer models.

## The local face models (each file's own licence)

| Model | What it does | Licence |
|---|---|---|
| YuNet (opencv_zoo `face_detection_yunet_2023mar.onnx`) | finds faces, 5 landmarks, a confidence | MIT |
| SFace (opencv_zoo `face_recognition_sface_2021dec.onnx`) | a "face print"; similarity 0–1 (0.363 = SFace's same-person line) | Apache 2.0 |
| MediaPipe Face Landmarker (BlazeFace short range + Face Mesh V2 + Blendshape V2) | head pose, mouth and eye openness | Apache 2.0 (model cards) |
| MediaPipe Pose Landmarker (BlazePose GHUM 3D, full) | body keypoints (how much of her is visible) | Apache 2.0 (model card) |

The libraries are `mediapipe` 1.2.0 and `opencv-contrib-python` 5.0.0.93, both Apache 2.0. The model files are
checked against pinned SHA-256 sums. Code: `services\audio\app\face.py` (`pnpm face check|scene-check|compare|calibrate|crop`).

## Tests

```
pnpm characters:test
pnpm test:audio tests/test_face.py
```

- `characters:test`: prompts, model inputs against fal's schemas, cost and cap, green/amber/red, retries, billing.
  It also runs the whole pack with a stand-in fal client, face check and billing (no network, no key).
- `test_face.py`: the reference-check rules, the thresholds, body visibility and lighting. With the face packages
  installed, it also runs the models on a picture without a face.
