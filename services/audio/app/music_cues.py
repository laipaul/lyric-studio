"""Music cues per sung line and instrumental gap (Performance script, Part B, 26 Nov 2026).

    python -m app.music_cues <song> --segments segments.json [--vocals vocal.wav] [--stems auto|none]

segments.json: [{"key": "L5", "start_ms": 12000, "end_ms": 15500}, ...]. Prints one JSON line.

Suno masters are heavily compressed (Paul, 26 Nov 2026), so nothing here uses absolute loudness for the musical
events: every measure is RELATIVE to the song's own range (percentile ranks of 0.5 s blocks), and the arrangement
density comes from the STEMS (drums / bass / other energy), not from the master's loudness:
  - stems "demucs": htdemucs's drums, bass, other and vocals (cached in <workspace>/cache/stems/ by the song's hash,
    the same cache the aligner uses; separated here when missing and Demucs is installed);
  - stems "bands" (no Demucs): the mix split by HPSS and frequency (percussive = drums, harmonic < 250 Hz = bass,
    harmonic 250 Hz - 5 kHz = other); the result says so.
The vocal for the vocal-vs-music contrast: --vocals (the Suno stem lined up, or the Demucs vocals), else the Demucs
vocals, else none (no contrast). The song is only read.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

ENGINE = 1
SR = 22050
HOP = 512
BLOCK_S = 0.5
STEM_NAMES = ("drums", "bass", "other", "vocals")


def _blocks(power: np.ndarray, n: int) -> np.ndarray:
    """Frame values (one per HOP) averaged into 0.5 s blocks (n blocks)."""
    per = BLOCK_S * SR / HOP
    out = np.zeros(n)
    for i in range(n):
        a, b = int(round(i * per)), int(round((i + 1) * per))
        seg = power[a:max(b, a + 1)]
        out[i] = float(np.mean(seg)) if seg.size else 0.0
    return out


def _db(power: np.ndarray) -> np.ndarray:
    return 10.0 * np.log10(np.maximum(power, 1e-12))


def _rms_power(y: np.ndarray) -> np.ndarray:
    import librosa

    return librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0] ** 2


def pct(x: np.ndarray) -> np.ndarray:
    """Percentile rank 0..1 of each value within the song itself (ties share a rank)."""
    if x.size < 2:
        return np.zeros_like(x, dtype=float)
    order = np.argsort(np.argsort(x, kind="stable"), kind="stable").astype(float)
    # ties: average rank of equal values
    uniq, inv = np.unique(x, return_inverse=True)
    sums = np.bincount(inv, weights=order)
    counts = np.bincount(inv)
    return (sums / counts)[inv] / (x.size - 1)


def smooth(x: np.ndarray, blocks: int) -> np.ndarray:
    if blocks <= 1 or x.size == 0:
        return x.astype(float)
    k = np.ones(blocks) / blocks
    pad = blocks // 2
    xp = np.pad(x.astype(float), (pad, blocks - 1 - pad), mode="edge")
    return np.convolve(xp, k, mode="valid")


def _load(path: Path) -> np.ndarray:
    import librosa

    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return y


def stem_files(song: Path, workspace: Path | None) -> dict[str, Path]:
    """The Demucs stems of this song in the shared cache (any that exist)."""
    if workspace is None:
        return {}
    from .cache import file_hash

    h = file_hash(song)
    base = workspace / "cache" / "stems"
    return {n: base / f"{h}-htdemucs-{n}.wav" for n in STEM_NAMES if (base / f"{h}-htdemucs-{n}.wav").exists()}


def band_stems(y: np.ndarray) -> dict[str, np.ndarray]:
    """No Demucs: the mix split into percussive (drums), low harmonic (bass) and mid harmonic (other) power per frame."""
    import librosa

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    H, P = librosa.decompose.hpss(S)
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    low = freqs < 250
    mid = (freqs >= 250) & (freqs < 5000)
    return {
        "drums": np.mean(P**2, axis=0),
        "bass": np.mean(H[low] ** 2, axis=0),
        "other": np.mean(H[mid] ** 2, axis=0),
    }


def analyse(y: np.ndarray, stems: dict[str, np.ndarray], vocals: np.ndarray | None, source: str) -> dict[str, Any]:
    """Block measures and events of the whole song. stems: name -> power per frame (drums, bass, other)."""
    import librosa

    n = max(1, int(np.ceil(len(y) / SR / BLOCK_S)))
    mix_db = _db(_blocks(_rms_power(y), n))
    onset = _blocks(librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP), n)
    centroid = _blocks(librosa.feature.spectral_centroid(y=y, sr=SR, hop_length=HOP)[0], n)
    stem_db = {k: _db(_blocks(v, n)) for k, v in stems.items()}
    # A stem is "playing" in a block when it is well within its own range and not near silence.
    active = {}
    for k, d in stem_db.items():
        floor = max(np.percentile(d, 30), np.max(d) - 30.0, -70.0)
        active[k] = d > floor
    density_n = sum(active[k].astype(int) for k in ("drums", "bass", "other") if k in active)
    stem_energy = np.mean([pct(stem_db[k]) for k in ("drums", "bass", "other") if k in stem_db], axis=0) if stem_db else np.zeros(n)
    energy_raw = (pct(smooth(mix_db, 4)) + pct(onset) + stem_energy + density_n / 3.0) / 4.0
    energy = smooth(energy_raw, 4)  # 2 s
    energy = (energy - energy.min()) / max(1e-9, energy.max() - energy.min())

    vocal_db = None
    music_db = None
    if vocals is not None:
        vp = _blocks(_rms_power(vocals), n)
        vocal_db = _db(vp)
        music_db = _db(np.maximum(_blocks(_rms_power(y), n) - vp, 1e-12))

    events = detect_events(energy, mix_db, stem_db.get("drums"), centroid)
    return {
        "n": n,
        "energy": energy,
        "mix_db": mix_db,
        "density": density_n,
        "vocal_db": vocal_db,
        "music_db": music_db,
        "events": events,
        "source": source,
    }


def _mean(x: np.ndarray, a: int, b: int) -> float:
    a, b = max(0, a), min(len(x), b)
    return float(np.mean(x[a:b])) if b > a else float("nan")


def detect_events(energy: np.ndarray, mix_db: np.ndarray, drums_db: np.ndarray | None, centroid: np.ndarray) -> list[dict[str, Any]]:
    """Builds, drops, breakdowns, sudden silences, drum entries and brightness changes, all relative to the song."""
    n = len(energy)
    ev: list[dict[str, Any]] = []
    last: dict[str, int] = {}

    def add(kind: str, i: int, gap: int = 8, **extra: Any) -> None:
        if i - last.get(kind, -999) < gap:
            return
        last[kind] = i
        ev.append({"type": kind, "at_ms": int(i * BLOCK_S * 1000), **extra})

    for i in range(4, n - 4):
        before = _mean(energy, i - 4, i)
        after = _mean(energy, i + 1, i + 5)
        jump = after - before
        if jump >= 0.3 and after >= 0.6 and energy[i + 1] - energy[i - 1] >= 0.12:
            # a build before it: a steady rise over the 4-8 s before
            rise = _mean(energy, i - 4, i) - _mean(energy, i - 16, i - 10)
            if rise >= 0.15:
                start = i - 16
                while start < i - 4 and energy[start + 1] <= energy[start] + 0.01:
                    start += 1
                add("build", max(0, start), to_ms=int(i * BLOCK_S * 1000))
            add("drop", i)
        elif -jump >= 0.3 and after <= 0.4 and energy[i - 1] - energy[i + 1] >= 0.12:
            add("breakdown", i)
    # A build that does not end in a drop: a steady rise of 0.3 over 6 s.
    for i in range(12, n):
        seg = energy[i - 12:i + 1]
        if seg[-1] - seg[0] >= 0.3 and np.all(np.diff(smooth(seg, 3)) > -0.03) and not any(e["type"] in ("build", "drop") and abs(e["at_ms"] - int(i * 500)) < 8000 for e in ev):
            add("build", i - 12, gap=16, to_ms=int(i * BLOCK_S * 1000))
    # Sudden silence: far below the song's own level right after a louder moment.
    p5, p50 = np.percentile(mix_db, 5), np.percentile(mix_db, 50)
    for i in range(2, n):
        if mix_db[i] <= p5 and mix_db[i] < p50 - 18 and _mean(mix_db, i - 2, i) > np.percentile(mix_db, 40):
            add("silence", i, gap=6)
    if drums_db is not None:
        d = pct(drums_db)
        for i in range(4, n - 4):
            b, a = _mean(d, i - 4, i), _mean(d, i, i + 4)
            if b < 0.25 and a > 0.5:
                add("drums in", i)
            elif b > 0.5 and a < 0.25:
                add("drums out", i)
    c = pct(smooth(centroid, 4))
    for i in range(4, n - 4):
        b, a = _mean(c, i - 4, i), _mean(c, i, i + 4)
        if a - b >= 0.4:
            add("brighter", i, gap=12)
        elif b - a >= 0.4:
            add("darker", i, gap=12)
    return sorted(ev, key=lambda e: e["at_ms"])


LEVELS = ["very soft", "soft", "medium", "loud", "very loud"]


def segment_cues(a: dict[str, Any], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    energy, density = a["energy"], a["density"]
    vocal_pct = pct(a["vocal_db"]) if a["vocal_db"] is not None else None
    music_pct = pct(a["music_db"]) if a["music_db"] is not None else None
    out = []
    for s in segments:
        i0 = int(s["start_ms"] / 1000 / BLOCK_S)
        i1 = max(i0 + 1, int(np.ceil(s["end_ms"] / 1000 / BLOCK_S)))
        e = energy[i0:i1] if i0 < len(energy) else energy[-1:]
        mean_e = float(np.mean(e))
        level = min(4, int(mean_e * 5))
        slope = float(e[-1] - e[0]) if e.size > 1 else 0.0
        trend = "rising" if slope >= 0.15 else "falling" if slope <= -0.15 else "steady"
        dn = density[i0:i1] if i0 < len(density) else density[-1:]
        dmode = int(np.bincount(dn.astype(int)).argmax()) if dn.size else 0
        dens = "sparse" if dmode <= 1 else "medium" if dmode == 2 else "full"
        evs = [e2 for e2 in a["events"] if s["start_ms"] - 500 <= e2["at_ms"] < s["end_ms"]]
        contrast = None
        vocal = None
        if vocal_pct is not None and music_pct is not None and s.get("sung", True):
            vp = float(np.mean(vocal_pct[i0:i1])) if i0 < len(vocal_pct) else 0.0
            mp = float(np.mean(music_pct[i0:i1])) if i0 < len(music_pct) else 0.0
            contrast = "soft vocal over a loud mix" if vp < 0.4 and mp > 0.6 else "loud vocal over sparse music" if vp > 0.6 and mp < 0.4 else "balanced"
            vocal = "loud" if vp > 0.66 else "soft" if vp < 0.33 else "medium"
            # a held note: the voice goes on without a dip for 1.5 s or more at the end of the line
            vd = a["vocal_db"][i0:i1]
            if vd.size:
                on = vd > (np.max(a["vocal_db"]) - 25)
                run = 0
                for v in on[::-1]:
                    if not v:
                        break
                    run += 1
                if run * BLOCK_S >= 1.5:
                    vocal += ", held note at the end"
        out.append({"key": s["key"], "level": level + 1, "level_word": LEVELS[level], "energy": round(mean_e, 3), "trend": trend, "density": dens, "events": evs, "contrast": contrast, "vocal": vocal})
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="music_cues")
    p.add_argument("song")
    p.add_argument("--segments", required=True)
    p.add_argument("--vocals")
    p.add_argument("--stems", default="auto", choices=["auto", "none"])
    p.add_argument("--workspace")
    o = p.parse_args(argv)
    song = Path(o.song)
    segments = json.loads(Path(o.segments).read_text(encoding="utf-8"))
    y = _load(song)
    workspace = Path(o.workspace) if o.workspace else None
    files = stem_files(song, workspace) if o.stems == "auto" else {}
    if o.stems == "auto" and workspace is not None and not all(k in files for k in ("drums", "bass", "other")):
        try:
            from .align import separate_stems  # Demucs (installed with pnpm audio:setup --ai)

            files = separate_stems(song, lambda m: print(f"[music cues] {m}", file=sys.stderr))
        except Exception as e:  # no Demucs: frequency bands
            print(f"[music cues] stems not available ({type(e).__name__}): using frequency bands", file=sys.stderr)
    if all(k in files for k in ("drums", "bass", "other")):
        stems = {k: _rms_power(_load(files[k])) for k in ("drums", "bass", "other")}
        source = "demucs"
    else:
        stems = band_stems(y)
        source = "bands"
    vocal_path = Path(o.vocals) if o.vocals else files.get("vocals")
    vocals = _load(vocal_path) if vocal_path and vocal_path.exists() else None
    if vocals is not None and len(vocals) != len(y):
        vocals = np.pad(vocals, (0, max(0, len(y) - len(vocals))))[: len(y)]
    a = analyse(y, stems, vocals, source)
    result = {
        "engine": ENGINE,
        "stems": source,
        "vocals": bool(vocals is not None),
        "block_s": BLOCK_S,
        "duration_ms": int(len(y) / SR * 1000),
        "energy": [round(float(x), 3) for x in a["energy"]],
        "events": a["events"],
        "segments": segment_cues(a, segments),
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
