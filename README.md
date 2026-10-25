# Lyric Studio

A personal, local studio for making 9:16 beat-synced lyric videos for **Life Lyrics**.
Everything runs on your own PC. See `CLAUDE.md` for the full brief and `PROGRESS.md` for status.

## What is in this repo

| Folder | What it is | Address |
| --- | --- | --- |
| `apps/studio` | The web app (Next.js): Home, Studio, Library | http://localhost:3000 |
| `apps/worker` | Background render worker (Node) | (no web page; prints `worker ready`) |
| `services/audio` | Audio analysis service (Python FastAPI + librosa): BPM, beats, downbeats | http://127.0.0.1:8001/health |
| `packages/video` | The Remotion video composition `LyricVideo` | |
| `packages/db` | Database (SQLite + Drizzle) and the workspace file service | `workspace/studio.db` |
| `workspace/` | Your songs, clips, thumbnails, renders and database (not saved to git) | |

## One-time setup on Windows

You need these installed once (normal Windows installers):

| Tool | Version | Check in Cursor's terminal |
| --- | --- | --- |
| Git | any recent | `git --version` |
| Node.js | 22 or 24 (LTS) — https://nodejs.org | `node --version` |
| pnpm | 10, 11 or 12 | `pnpm --version` |
| Python | **3.12** (other versions may also be installed) | `py -0` must list `-V:3.12` |
| FFmpeg | any recent (needed from the render steps on) | `ffmpeg -version` |

Notes:
- **Python 3.12 is required.** The audio service always uses `py -3.12`, never the default `python`,
  so it is fine if Python 3.14 (or another version) is your default. If `py -0` does not show
  `-V:3.12`, install Python 3.12 from https://www.python.org/downloads/windows/.
- **pnpm**: if `pnpm --version` does not work, open PowerShell **as Administrator** once and run
  `corepack enable` (Corepack ships with Node.js), then reopen Cursor.

## Get the code (first time)

```powershell
cd D:\
git clone https://github.com/laipaul/videomaker.git
cd D:\videomaker
pnpm install
pnpm audio:setup
```

`pnpm audio:setup` creates a private Python 3.12 environment in `services\audio\.venv`
(using `py -3.12`) and installs librosa and friends from ready-made packages (about 300 MB, no compiler).
It reinstalls automatically when the package list changes, also from `pnpm dev`, `pnpm analyze` and `pnpm test`. Nothing is installed globally. If an old `.venv` was made with another
Python version, it is removed and rebuilt automatically.

## Get the latest changes

```powershell
cd D:\videomaker
git pull
pnpm install
pnpm audio:setup
```

## Run it

```powershell
pnpm dev
```

This first prepares the database (`[db] ready: ...`), then starts all three parts in one terminal. Each line is tagged `[studio]`, `[worker]` or `[audio]`.
You should see:

- `[worker] worker ready`
- `[studio] ... Ready`  → open http://localhost:3000
- `[audio] Uvicorn running on http://127.0.0.1:8001`  → open http://127.0.0.1:8001/health
  and you should see `{"status":"ok","service":"audio"}`

Stop everything with **Ctrl+C**. The studio listens on this PC only (http://localhost:3000 works,
other devices on your network cannot reach it); set `STUDIO_HOST=0.0.0.0` in `.env` only if you ever
want that.

## The Lyric Studio app

### Start and stop (no terminal needed)

- Double-click **`Start Lyric Studio.cmd`** in `D:\videomaker`. It starts the studio, the worker and
  the audio service in a minimised window ("LyricStudioServer"), waits until they answer, then opens
  Lyric Studio in its own Edge window. The first start after a `git pull` builds the app first
  (1-2 minutes); later starts take a few seconds. If it is already running, it just opens the window.
  The log is in `logs\lyric-studio.log`.
- Double-click **`Stop Lyric Studio.cmd`** to stop everything.
- **Desktop shortcut** with the Life Lyrics icon: double-click **`Create Desktop Shortcut.cmd`** once
  (run it again after changing `workspace\brand\logo.png`). By hand instead: right-click the desktop →
  New → Shortcut → `D:\videomaker\Start Lyric Studio.cmd` → name it "Lyric Studio" → Properties →
  Change Icon → `D:\videomaker\Lyric Studio.ico` (made by `pnpm app:icons`), Run: Minimized.

### Install as an app

With Lyric Studio open in Edge or Chrome: menu **…** → **Apps** → **Install Lyric Studio** (Chrome: the
install icon in the address bar). It then has its own window and taskbar icon (the flower from
`workspace\brand\logo.png`, remade automatically when the logo changes). It needs no internet; the
app still needs `Start Lyric Studio.cmd` to be running (it is the local server).

### Library

The start page: one card per song with its cover, title, artist (and EP) and, per platform, how many
videos its latest run made and their state (green PASS, amber WARN, red FAILED, pink "…" while
rendering, "—" not made yet). Search finds songs by title, artist or EP.

**+ New song**: the song (WAV/MP3) and `lyrics.txt` are required; a cover, a hints file (tapped
`.lrc`), the title (default: the song's file name), the artist (default "Life Lyrics"; the list shows
every artist used so far) and the EP are optional. Everything is stored with the project, so
`pnpm make` uses it too (the hints, the EP, the cover). Adding the same song again (even under another
file name) updates that song instead of making a second one.

### Song page

Click a song card. You see every run of the song, also the ones made with `pnpm make` in the
terminal, newest first, grouped by platform:

- **Tiles**: a still frame of each video; hover to play it (muted). The QA badge (PASS / WARN) shows
  its reasons on hover or click, and so does every WARN / FAILED / interrupted badge on the cards.
- **Marks**: ☆ favourite, **Approve**, **Discard** (hides the video; nothing is deleted; "Show
  discarded" brings it back, **Restore** undoes it). Filters: platform, favourites only.
- **Compare**: tick 2-3 videos and press **Compare**: they play side by side with one play button and
  one timeline (sound from the first), with what differs highlighted (style, order, effects, bars, QA).
- **Post** ("ready to post"): the caption and hashtags to copy, the video / .srt / (YouTube) thumbnail
  and publish.txt to download, and **Open folder** (Explorer with the file selected).
- **Interrupted** (orange "!"): a run that was stopped (window closed, PC restarted). It never shows
  "rendering" forever; the badge shows which videos are missing and the exact command to finish them
  (`... --resume`; one click from Step 6.2b).

Captions come from text templates per platform, per artist: `workspace\brand\publish-reels.txt`,
`publish-tiktok.txt`, `publish-shorts.txt` (English defaults, made the first time). For an artist's
own captions (Pômé in French) press **Make Pômé's own template** in the Post window: it copies the
template to `workspace\brand\Pômé\` to edit there. Placeholders: `{{song}} {{artist}} {{ep}}
{{epLine}} {{hook}} {{songTag}} {{artistTag}} {{year}}` (`{{hook}}` is the first hook line; a line with
an empty value disappears; lines starting with `# ` are notes). YouTube uses the `publish.txt` made
with each video.

### Artists

Each song has its artist (Life Lyrics, Pômé, a client, ...): titles, thumbnails, the title overlay and
`publish.txt` use it. `pnpm make --artist "Pômé"` sets it from the command line. An artist can have
their own brand: `workspace\brand\<artist>\brand.json` (plus `logo.png` and
`publish-template.txt` there); without one, the Life Lyrics brand in `workspace\brand\` is used.

## Audio analysis

```powershell
pnpm analyze "D:\Music\my song.mp3"
pnpm analyze "D:\Music\my song.mp3" --bpm 140
pnpm analyze "D:\Music\my song.mp3" --json
pnpm analyze "D:\Music\my song.mp3" --click
pnpm analyze "D:\Music\my song.mp3" --downbeat-offset 1
```

Prints the BPM, the half/double alternatives, the duration, the downbeat confidence and the first
16 beats with the downbeats (start of each bar) marked. `pnpm dev` does not need to be running.

- **Half / double tempo**: songs are often detected at half or double speed (70 instead of 140).
  If the beats feel too slow or too fast, run it again with `--bpm` set to the half or double value
  shown. Any other BPM you give re-tracks the beats around that tempo (and is fine-tuned by at most 3%).
- **Downbeat confidence** (0–1): how clearly one beat of the bar stands out in the bass/kick.
  0.4 or more = high, 0.15–0.4 = medium, below 0.15 = low (the bar start is a guess; this is
  common when the kick is equally strong on beats 1 and 3). The method assumes 4/4.
- **Cache**: results are saved in `workspace\cache\analysis\` by the file's content, so the same
  song is analysed only once (even if renamed). Delete that folder to force a fresh analysis.
- **Check the beat grid by ear**: `--click` writes `<song>_click.wav` next to the song: the song
  with a low click on every beat and a louder, higher click on every bar start (downbeat).
- **Bar 1 in the wrong place?** `--downbeat-offset 1`, `2` or `3` makes bar 1 start that many beats
  later. If the file is a project's song, the offset is saved to that project and used from then on.
- WAV, MP3 and FLAC work.

The service also offers `POST http://127.0.0.1:8001/analyze` with
`{"path": "<path inside the workspace>", "project_id": "<optional>", "bpm": <optional>}`.
With `project_id` it stores the BPM and duration on the project and replaces its beats.

## Cut points

```powershell
pnpm cuts "D:\Music\my song.mp3" --section 0:11-0:59
pnpm cuts "D:\Music\my song.mp3" --section 0:11-0:59 --rate 2x --energy high --early 2 --downbeat-offset 1
```

Prints where the video would cut inside that part of the song: the time and video frame of each
cut, the beat number, the bar and beat in the bar (`7.1` = bar 7, beat 1), and each shot's length.

| Option | Values | Meaning |
| --- | --- | --- |
| `--rate` | `0.5x`, `1x` (default), `2x` | cut every 2 bars / every bar / every half bar |
| `--energy` | `low`, `medium` (default), `high` | low = half as many cuts, high = twice as many |
| `--early` | `0`–`4` (default `2`) | cut this many frames (1/30 s) before the beat; slightly early feels on time |
| `--downbeat-offset` | `0`–`3` | move bar 1 (as for `pnpm analyze`) |

No shot is shorter than 0.8 s: if the cuts would be too fast, the whole section switches to the next
slower even rhythm (every beat → every 2 beats → every bar) and the command says so.

## Lyric timing (`pnpm tap`)

Write the lyrics in a text file, one lyric line per line. A blank line means a pause (the previous
line disappears there, e.g. for an instrumental part). Then:

```powershell
cd D:\videomaker
pnpm tap "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --section 0:11-0:59
```

The section plays. Press **Enter** exactly when each line starts (the next line is always shown).
After the last line, press **Enter** once more where it ends. **Backspace** redoes the last stamp,
**r** restarts the section, **q** quits without saving. Each stamp is printed as you go, and at the
end `lyrics.lrc` is written next to `lyrics.txt` (the previous one is kept as `lyrics.lrc.bak`).
Stamps are moved 0.15 s earlier by default to make up for reaction time (`--shift 0` turns
that off, `--shift -0.25` moves them more).

A line starting with `* ` in `lyrics.txt` is a **hook** (it can get its own font). Every line with
the same words is then a hook too, so marking one chorus is enough.

### Fixing timing and hooks in an existing .lrc

```powershell
cd D:\videomaker
pnpm lrc:shift workspace\test\lyrics.lrc -0.3
pnpm lrc:hook workspace\test\lyrics.lrc "Hope is a good thing"
```

- `lrc:shift` moves every stamp (negative = earlier) and keeps the old file as `lyrics.lrc.bak`.
- `lrc:hook` marks that line and all its repeats as hook (`[00:14.00]* Hope is a good thing`).
  Matching ignores upper/lower case, punctuation and extra spaces. You can also type the `* `
  yourself in the .lrc, right after the time stamp.

Before playing, every line is checked for phone screens. A line that would need 3 lines on screen
prints e.g. `WARNING: Line 3 is too long for phone screens (Bold style); split it in lyrics.txt`.

## Automatic lyric timing (`pnpm align`)

Instead of tapping, the computer can place the lyrics itself: Demucs separates the vocals, then
WhisperX lines up every word of your `lyrics.txt` with the voice.

**One-time install** of the AI packages (large: PyTorch with CUDA is about 3 GB):

```powershell
cd D:\videomaker
pnpm audio:setup --ai
```

On Windows this installs the CUDA 12.8 build of PyTorch, which runs on NVIDIA RTX 50-series GPUs
(and also on the CPU). `pnpm audio:setup --ai --torch cpu` installs the smaller CPU-only build.
The AI models (Demucs ~80 MB, English alignment ~360 MB, French alignment ~1.2 GB) download on
first use into `services\audio\models\` with a progress bar.

```powershell
cd D:\videomaker
pnpm align "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt"
pnpm align "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --lang fr
pnpm align "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --compare "D:\videomaker\workspace\test\Lyrics.lrc"
```

- It first prints the device: `GPU: NVIDIA GeForce RTX 5060 Laptop GPU (CUDA 12.8, …)` or
  `CPU (reason)`. If the GPU fails, it retries on the CPU and says so. `--device cpu` forces the CPU.
- Writes `lyrics.lrc` next to `lyrics.txt` (old one kept as `lyrics.lrc.bak`), with word timings
  (`[00:14.00]* <00:14.00>Hope <00:14.42>is …`). `* ` hooks and blank-line pauses are kept.
- Lists every line with its confidence; lines below 0.5 are shown in orange. Check them by ear and
  re-tap or edit their stamp.
- `--compare <tapped.lrc>`: per-line differences in ms, the median, the worst 5, the typical
  offset with the matching `pnpm lrc:shift` command, and your tapped time next to low-confidence
  lines. If the output would overwrite the comparison file (on Windows `lyrics.lrc` = `Lyrics.lrc`),
  it writes `lyrics.aligned.lrc` instead.
- `--diagnose "2,9"` (quote the list in PowerShell; `"2 9"` also works): for those lines, what the aligner heard: words with scores, a loudness chart of
  the vocal track (A = aligned, T = tapped), the bursts of voice nearby, a best guess (reverb tail,
  breath, quieter backing vocal, …) and two WAV snippets of the vocals only (at the aligned and at
  the tapped time) in `workspace\cache\diagnose\` — listen to them.
- `--hint <taps.lrc>`: for lines below 0.7 confidence only, uses your tapped time (corrected by the
  typical offset) and moves the line to the nearest start of the voice, re-aligning that line on its
  own. The adjusted lines are listed. The hint file is never overwritten.
- `--trim off` turns off the correction for words stretched over a silent gap.
- `--report file.json` also writes each line's confidence and sung times; `--fresh` ignores the
  cached alignment (both used by `pnpm make`).
- Each line ends with a tag for where its last word ends (`… <00:14.00>is <00:14.90>`), which
  `pnpm make` uses to cut between lines, never in the middle of one.
- The vocal track and the alignment are cached (`workspace\cache\stems`, `workspace\cache\align`),
  so running it again is quick.

## One-click videos (`pnpm make`)

One command from a song to several finished videos. Copy your clips into a collection folder
`workspace\clips\<name>\` (for example `workspace\clips\wedding\`), then:

```powershell
cd D:\videomaker
pnpm make "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --collection wedding
```

What it does, in order:

1. **Project**: finds the song's project by its content (or creates one) — renaming or moving the
   song file does not matter.
2. **Beats**: the analysis from `pnpm analyze` (cached).
3. **Lyrics**: runs `pnpm align` automatically (needs `pnpm audio:setup --ai` once). The result is
   stored in `workspace\projects\<id>\lyrics\aligned-….lrc` and **never rewritten**: the next run with
   the same `lyrics.txt` reuses it. `--realign` makes a new alignment (a new file; the old one stays).
   `--hint <taps.lrc>` passes tapped times to the aligner **and is remembered by the project**: later
   runs use it automatically ("using stored hints from …"), also after `lyrics.txt` changes;
   `--no-hint` aligns once without them (with a warning). Hook lines: `* ` in `lyrics.txt`;
   changing only the `* ` markers does not align again.
4. **Section** (`--section auto`, the default): starts one bar before the first hook line (the first
   chorus) and ends on the first bar after a lyric line finishes, 45-60 s later, preferably after a
   chorus line. It never ends in the middle of a line: if needed it goes up to 65 s. Without hooks it
   uses the most repeated block of lines. The reason is printed. `--section full` = whole song,
   `--section 0:11-1:10` = exactly that part (the start snaps to the nearest bar).
5. **Clips**: new or changed clips in the collection folder are imported automatically (compared by
   content); deleted ones are dropped. `--collection-path D:\clips\beach` uses another folder.
6. **Variations** (`--variations 6`): v1 in story order, v2… shuffled with different seeds; Simple
   and Bold alternate; cinematic bars on every other one (v2, v4, v6). `--font` / `--font-hook`
   apply to all.
7. **Rendering**: on Windows one video at a time (two at once ran out of memory), using up to 8
   frames in parallel and a capped clip cache, staying under 40% of the PC's memory (see the
   `Rendering:` line it prints; `--parallel N` to change). A video that fails is tried once more with
   half the frames in parallel; a render with no progress for 5 minutes is stopped. The other videos
   always carry on, and failures are listed at the end.
8. **Output**: `workspace\projects\<id>\exports\<YYYY-MM-DD_HHmm>\` with `v1.mp4 … v6.mp4`, and for
   each a `v1.manifest.json` (everything needed to make the same video again) and `v1.qa.txt`. At
   the end a table (variation, style, order, duration, QA) is printed and the folder opens in
   Explorer (`--no-open` to skip).

**QA** checks per video: lyric lines with low alignment confidence (< 0.5), the same clip again
within 3 shots, black or frozen frames, lyric lines on more than 2 lines, shots under 0.8 s, lyrics
outside the safe zone. Result: `PASS`, or `WARN` with the reasons.

**Same video again**: `pnpm rerender "<export folder>\v1.manifest.json"` renders `v1.rerender.mp4`
next to it, identical to v1. It refuses (and says which file) if the song, a clip or a font has
changed since.

| Option | Default | Meaning |
| --- | --- | --- |
| `--collection <name>` | the project's last one | the folder `workspace\clips\<name>\`; needed the first time per project, then remembered ("using collection wedding (remembered)") |
| `--collection-path <folder>` | the project's last one | clips from another folder (not copied); remembered with the collection |
| `--variations N` | from the preset (standard: 6) | number of videos (per platform) |
| `--section` | `auto` | `auto`, `full` or `0:11-1:10` |
| `--hint <taps.lrc>`, `--realign`, `--lang fr` | | passed to `pnpm align` (see above); the hint is remembered by the project |
| `--no-hint` | | align once without the project's stored hints (warns) |
| `--lrc <file.lrc>` | | use this LRC instead of aligning (stored as-is) |
| `--lyrics-offset S` | `0` | move all lines (seconds); saved to the project, the LRC stays unchanged |
| `--lead`, `--rate`, `--energy`, `--font`, `--font-hook`, `--pins`, `--downbeat-offset` | | as for `pnpm render:test` |
| `--line-effect`, `--hook-effect` | brand.json (glide / karaoke-highlight) | lyric effect for verse / hook lines, e.g. `soft-blur:subtle` (see Lyric effects) |
| `--platforms reels,tiktok,shorts` / `all` | (standard) | one folder per platform, presets from `presets\platforms.json` |
| `--allow-fill` | | also use sources of the other orientation, shown whole over a blurred copy |
| `--title "My Song"` | file name | the song's title (title overlay, thumbnail, publish.txt; saved) |
| `--cover <image>` | stored cover | YouTube cover layout (stored with the project) |
| `--layout cover\|stills\|clips` | `cover` | YouTube layout |
| `--stills <file>`, `--no-grain`, `--no-glow` | | YouTube stills layout |
| `--ep "EP name"` | | adds "From the EP …" to publish.txt |
| `--parallel N` | `1` on Windows | videos rendered at the same time |
| `--resume` | | in the latest export folder, render only the videos that are missing or failed (refused if the section, lyrics, cuts, settings or clips changed since) |
| `--no-open` | | do not open the folder at the end |

### Platforms (`--platforms`)

```powershell
cd D:\videomaker
pnpm make "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --collection wedding --platforms reels,tiktok,shorts
```

`--platforms all` makes every platform that is ready. Each platform gets its own folder inside the
run's folder (`exports\<date>\reels\v1.mp4 …`) with its own manifests and QA, plus one clean
`<song>.lrc` for Musixmatch / LyricFind. Without `--platforms`, the "standard" preset is used
(45-60 s, 6 videos, files directly in the run's folder).

| Platform | Size | Length | Videos | Notes |
| --- | --- | --- | --- | --- |
| reels | 1080x1920 | ~30 s, hook-first | 3 | ends on a bar with a 0.12 s fade; the last shot leads into the first (seamless loop) |
| tiktok | 1080x1920 | ~25 s, hook-first | 3 | taller caption area at the bottom |
| shorts | 1080x1920 | ~50 s, hook-first | 2 | |
| youtube | 1920x1080 | the whole song | 1 | cover / stills / clips layouts, end-screen area, thumbnail, publish.txt (see below) |
| canvas | 1080x1920 | 3-8 s loop, whole bars | 1 | Spotify Canvas: no lyrics, no text, no logo, no audio (see below) |

Hook-first: the video starts at most one bar before the first hook line, so the hook is heard
within about 2.5 s. It ends on a bar (TikTok and Shorts: on any beat if no bar fits) after a line's
last word has ended and before the next line starts (never mid-word), within ±15% of the target; if that is impossible, a clean end up to 25%
shorter is chosen before a longer one, and the reason line says so. A video that does cut a sung
line gets QA WARN with the line named.

Everything above is in `presets\platforms.json` and can be edited (size, length, number of videos,
safe zones, where the lyrics sit, text scale, bitrate, fade-out). `pnpm make` checks the file and
names any wrong value. The lyrics are placed from each platform's safe zones (centred in the free
area, slightly above its middle), never outside them.

### YouTube (`--platforms youtube`)

```powershell
cd D:\videomaker
pnpm make "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --collection wedding --platforms youtube --cover "D:\videomaker\workspace\test\cover.jpg" --title "My Song"
```

A 1920x1080 video of the whole song (from 0:00) in `exports\<date>\youtube\`, with:

- **Layout** (`--layout cover|stills|clips`, default `cover`):
  - **cover**: your square cover on the left with a very slow zoom (1.00 → 1.08), a gentle drift and a
    soft shadow, the same cover blurred and darkened behind it (moving slightly the other way), the
    lyrics on the right (current line large, next line faded), title and "Life Lyrics" small at the top
    over the lyrics, your logo. Chorus sections get a slightly warmer, brighter background, verses a
    softer one (smooth 2 s changes). The cover comes from `--cover` (stored with
    the project, so next time it is found by itself), else `cover.jpg` / `cover.png` next to the song.
    Without a cover it switches to stills, then clips, and says so.
  - **stills**: one horizontal photo per lyric section (intro, verse 1, chorus 1, …, found from the
    blank lines and `* ` hooks). Choose them in `stills.txt` next to `lyrics.txt` (or in the collection
    folder; or `--stills <file>`): `chorus = 03_bride.jpg`, `chorus 2 = 07_dance.jpg`, `verse = …`,
    `bridge = …`, `intro = …`, `outro = …`; otherwise in file-name order. 1.5 s crossfades on the beat,
    slow zoom and pan, subtle film grain and a soft glow pulsing on the beat (`--no-grain`, `--no-glow`).
  - **clips**: the beat-cut montage with horizontal clips and photos.
- The title and "Life Lyrics" over the opening seconds (gone by ~4 s) in Cinzel and the accent colour.
- In the **last 20 s** the bottom-right stays free for YouTube's end-screen elements (the lyrics move up).
- `thumbnail.jpg` (1280x720) and `publish.txt` (title, description with the full lyrics, credits,
  Spotify link placeholder, hashtags, tags). Edit `workspace\brand\publish-template.txt` to change
  the wording; placeholders: `{{song}}`, `{{artist}}`, `{{lyrics}}`, `{{songTag}}`, `{{artistTag}}`, `{{year}}`.
- `--title "My Song"` sets the song's title (saved with the project); otherwise it is the file name.
- `--ep "In The Mood for Life"` adds `From the EP "In The Mood for Life"` to `publish.txt` (template
  placeholder `{{epLine}}`; older templates get the line after the first description line).
- **Logo**: on YouTube videos only (by default), bottom right, fading out just before the last 20 s
  (end screen). It always sits in a corner of the frame, 3% of the width from both edges (never
  mid-frame; QA "Logo in a frame corner"). Choose in `workspace\brand\brand.json`:
  `"logo": { "platforms": ["youtube"], "youtube": "bottom-right", "vertical": "auto", "size": 0.08 }`;
  add e.g. `"reels"` to `platforms` to show it there too (`vertical`: the corner on 9:16 videos,
  `auto` = bottom right). The old `"position"` setting is no longer used.

Every video on every platform also gets a `.srt` caption file next to it (`v1.srt`, …).

**Clips and photos**: a collection may mix vertical and horizontal clips and photos (`.jpg`, `.png`,
`.webp`). Vertical videos use vertical (or square) sources; horizontal ones are skipped and listed,
unless `--allow-fill` (shown whole over a blurred copy). With too few suitable sources the QA says how
many are needed. Photos get a slow zoom and pan (Ken Burns) over exactly their shot.

**Brand**: `workspace\brand\brand.json` (created the first time) holds the fonts — Cinzel for titles,
Cormorant Garamond for verses, Kaushan Script for hook lines —, the accent colour (#E8A3B5), and the
logo (`workspace\brand\logo.png`) position and size. The lyrics use the brand fonts; `--font` /
`--font-hook` still override them, and `"useForLyrics": false` goes back to the Simple/Bold fonts.

### Spotify Canvas (`--platforms canvas`)

```powershell
cd D:\videomaker
pnpm make "D:\videomaker\workspace\test\song.wav" "D:\videomaker\workspace\test\lyrics.txt" --collection wedding --platforms canvas
```

One silent 1080x1920 loop in `exports\<date>\canvas\` (`v1.mp4`, manifest, QA; no .srt):

- **Length**: the longest whole number of bars that fits in 3-8 s at the song's tempo (120 BPM:
  4 bars = 8.00 s; 107 BPM: 3 bars = 6.75 s). Very slow songs: whole beats.
- **Clips too short?** It does not give up: 1) fewer bars (e.g. 3 -> 2, as long as the loop is at
  least 3 s); 2) the clip slowed down (down to 0.6x) to fill that loop; 3) a vertical photo moving
  slowly out and back. Only then it stops, saying what would work. The plan prints which fallback
  was used ("fallback 1 (fewer bars): ...").
- **Strongest moment**: every vertical clip is scored with FFmpeg (motion, colour, contrast, 10
  samples a second); the best window without a hard scene change inside wins. `--variations 3` gives
  the best moment of 3 different clips.
- **Seamless**: the last 0.5 s fades in the 0.5 s of the clip just before the loop's start, so the
  last frame flows straight into the first (also for a slowed clip). A photo moves out and back so
  it ends where it started.
- **QA**: "Seamless loop" (the jump from the last frame to the first is no bigger than an ordinary
  frame step), "No audio", "Length 3-8 s".
- Upload it in Spotify for Artists (Canvas). Spotify shows its own song info over it.

### Lyric effects (`--line-effect`, `--hook-effect`, `pnpm effects:preview`)

How lyric lines come in and go. Default: **glide** for verses (like Apple Music / Spotify: the line
moves up and fades, the next line, waiting small underneath, rises into place) and
**karaoke-highlight** for hooks (the word being sung lights up in your accent colour).

| Effect | What it does |
| --- | --- |
| glide | lines scroll up; the next line waits small underneath and rises into place |
| cinematic-fade | slow fade out, then a slow fade in settling from slightly larger |
| soft-blur | comes into focus from a soft blur (at most 4 px) |
| dreamy-glow | glows up out of a soft haze, then breathes gently |
| word-reveal | each word rises in on the voice |
| karaoke-highlight | the word being sung lights up in the accent colour |
| floating | drifts in from below, then floats gently |
| typewriter | letters typed in, each word complete when it is sung |

Each effect has an intensity: `subtle`, `balanced` (default) or `expressive`, e.g. `glide:subtle`.
Every line is fully readable 0.25 s before it is sung. Before an instrumental pause, the last line
fades out 1 s after its last word (instead of staying on screen).

Where to choose (the later one wins):

1. `workspace\brand\brand.json`: `"motion": { "verseEffect": "glide", "hookEffect": "karaoke-highlight" }`
   (also `{ "name": "floating", "intensity": "subtle", "durationMs": 800, "easing": "ease-out" }`).
2. `presets\platforms.json`, per platform: `"motion": { "verseEffect": "soft-blur:subtle" }`, and
   `"showNextLine": false` to hide the waiting next line on that platform.
3. The command line: `--line-effect cinematic-fade --hook-effect word-reveal:expressive`.

Watch them on your own song (uses the clips, fonts and timing of the project's latest `pnpm make`):

```powershell
cd D:\videomaker
pnpm effects:preview song
pnpm effects:preview song --effect soft-blur:subtle
```

The first makes `effects-preview.mp4` (all 8 side by side, labelled; your current choices are marked);
the second one effect full-size, 9:16 and 16:9. They are saved in
`workspace\projects\<id>\exports\effects-<date>\`. `song` is the project title (the song's file
name), its id, or the song file.

## Test render (`pnpm render:test`)

Put the test material in `workspace\test\`: `song.wav` (or `song.mp3`), a `clips\` folder with video
clips, and `lyrics.lrc` (from `pnpm tap`). Then:

```powershell
cd D:\videomaker
pnpm render:test
pnpm render:test --seed 7 --style bold --bars --rate 2x --energy high
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--song`, `--clips`, `--lrc` | files in `workspace\test\` | other files |
| `--section 0:11-0:59` | first to last lyric line | part of the song (the start snaps to the nearest bar) |
| `--rate`, `--energy` | `1x`, `medium` | as for `pnpm cuts`; `--rate off` = one shot per lyric line |
| `--order` | `story` | `story` = clips in file-name order (01_, 02_, …), `shuffle` = random by seed |
| `--seed` | `1` | shuffle only: which clips go where (same seed = same video) |
| `--pins` | `workspace\test\pins.txt` if present | force clips onto lyric lines (see below) |
| `--lead` | `0.25` | lines appear this many seconds before their stamp |
| `--lyrics-offset` | `0` | move all lines (seconds; negative = earlier), e.g. `-0.3` |
| `--font`, `--font-hook` | the style's font | font family for the lyrics / for hook lines (see `pnpm fonts`) |
| `--style` | `simple` | `simple` or `bold` |
| `--bars` | off | cinematic black bars top and bottom |
| `--downbeat-offset` | from analysis | move bar 1 |
| `--out` | `workspace\test\renders\<style>-seed<seed>.mp4` | output file |

**Story order**: name your clips `01_intro.mp4`, `02_walk.mp4`, … and they play in that order,
cycling when the section has more shots than clips (a clip shown again continues where it stopped).

**Pins** (`workspace\test\pins.txt`), one per line:

```
Love is a good thing = 07_hero.mp4
Another line = 03_city
```

The clip goes onto the shot where that lyric line appears on screen, every time the line occurs.
Pins beat the order mode. Lines starting with `#` are comments. Warnings are printed when a line or
clip is not found, a line is outside the section, or two pins hit the same shot.

**Fonts**: `pnpm fonts` lists every font with its weights, italics and whether it has é è à ç œ.
Put your own `.ttf`, `.otf` or `.woff2` files in `workspace\fonts\`; they appear in that list under
their real family name. Example: `pnpm render:test --font "Playfair Display" --font-hook "Caveat Brush"`.

The output is 1080x1920, 30 fps, H.264, AAC 192 kbps, yuv420p, faststart. The first render
downloads Remotion's headless Chrome once (~100 MB, inside the project) and prepares the clips
(converted copies are kept in `workspace\cache\normalised\`), so later renders are faster.

## Preview page

With `pnpm dev` running, open http://localhost:3000/preview. It plays the same video as
`pnpm render:test` (same files, same composition, same props). **Story / Shuffle** switches the clip
order (**Shuffle** button = new seed), **Simple / Bold** switches the text style, the **Lyrics offset**
slider moves the lines (it shows the `pnpm lrc:shift` command to make it permanent), pin warnings
are listed, and the page shows the exact `pnpm render:test` command to export what
you see. Tick **Show safe-zone guides** (or open http://localhost:3000/preview?safe-guides) to see the
areas covered by TikTok / Reels / Shorts buttons (red) and the lyric area (blue); guides are never
rendered into the export. **Reload files** picks up changed songs, clips or lyrics.

## Database

| Command | What it does |
| --- | --- |
| `pnpm db:show` | Shows the database location, the number of rows in each table, and the 10 style presets |
| `pnpm db:setup` | Creates or updates the database and adds the style presets (also done by `pnpm dev`) |
| `pnpm db:migrate` | Only applies database updates (migrations) |
| `pnpm db:seed` | Only adds missing style presets |

Running these again is always safe; nothing is duplicated or deleted.

## Settings (.env)

Optional. Copy `.env.example` to `.env` and edit it:

```powershell
Copy-Item .env.example .env
notepad .env
```

- `WORKSPACE_DIR` — where songs, clips, thumbnails, renders and the database live.
  Default `./workspace`. To use another drive: `WORKSPACE_DIR=D:\LyricStudio\workspace`.
  To move existing media, stop `pnpm dev`, move the whole folder, then update this line.
  (The database stores paths relative to this folder, so nothing else needs changing.)
- `FFMPEG_PATH` / `FFPROBE_PATH` — only if `ffmpeg -version` does not work in the terminal.

## Tests and checks

Tests also run automatically on GitHub (Actions → "Tests") after every push to `main`. The real AI
model tests for `pnpm align` run in a separate workflow (Actions → "AI alignment"), on demand and
when the audio service changes. Locally: `pnpm test:audio -m ai` (needs `pnpm audio:setup --ai`).

```powershell
pnpm test        # automated tests
pnpm typecheck   # TypeScript checks
```

Next.js telemetry (anonymous usage data) is switched off for this project. To confirm:
`pnpm --filter @lyric/studio telemetry` prints "You have opted-out".

### Updating the AI packages

`services/audio/requirements-ai.in` lists them; the exact versions are in
`requirements-ai-windows.txt` / `requirements-ai-linux.txt`, generated with
`uv pip compile --python-platform <x86_64-pc-windows-msvc | x86_64-manylinux_2_28> --python-version 3.12
requirements-ai.in -c requirements.txt --no-emit-package torch --no-emit-package torchaudio
--no-emit-package torchvision` (plus `--no-emit-package nvidia-…` for Linux).

## Troubleshooting

- **"running scripts is disabled on this system"** when typing `pnpm`: PowerShell is blocking scripts.
  Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then reopen the terminal.
- **"Python 3.12 was not found"**: run `py -0`. If `-V:3.12` is missing, install Python 3.12
  (see the table above), reopen Cursor, then run `pnpm audio:setup`.
- **`pnpm audio:setup` says "No matching distribution" or "Could not find a version"**: a Python
  package has no ready-made version for this PC. Nothing is compiled on purpose; report the
  message so the pinned versions can be adjusted.
- **"FFmpeg was not found"**: check that `ffmpeg -version` and `ffprobe -version` work in Cursor's
  terminal (reopen Cursor after installing FFmpeg), or set `FFMPEG_PATH` / `FFPROBE_PATH` in `.env`.
- **"Port 3000 (or 8001) is already in use"**: an earlier `pnpm dev` is still running.
  Close other terminals that run it, or restart Cursor.
- **Windows Firewall pop-up for Node.js or Python**: choose "Allow" for private networks. Everything stays on your PC.
