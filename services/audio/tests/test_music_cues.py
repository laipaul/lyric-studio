"""Music cues (Performance script, 26 Nov 2026): a synthetic song with a known shape. A quiet pad (0-10 s), a build
(10-16 s, rising noise and a riser), a drop with drums and bass at 16 s, a breakdown at 26 s (the pad alone again).
Compressed on purpose (the loud part is only a few dB louder, as in a Suno master): the events must still be found
from the song's own range and the arrangement, not from absolute loudness."""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from app import music_cues

SR = 22050


def synth(path: Path) -> None:
    rng = np.random.default_rng(7)
    t = np.arange(int(32 * SR)) / SR
    pad = 0.12 * (np.sin(2 * np.pi * 220 * t) + 0.5 * np.sin(2 * np.pi * 277 * t))
    y = pad.copy()
    build = (t >= 10) & (t < 16)
    ramp = np.clip((t - 10) / 6, 0, 1)
    y += build * ramp * 0.25 * rng.standard_normal(t.size) * np.sin(2 * np.pi * (400 + 600 * ramp) * t) ** 2
    drop = (t >= 16) & (t < 26)
    kick = np.zeros_like(t)
    for beat in np.arange(16, 26, 0.5):
        i = int(beat * SR)
        n = int(0.12 * SR)
        k = np.arange(n) / SR
        kick[i:i + n] += 0.9 * np.sin(2 * np.pi * (120 - 400 * k) * k) * np.exp(-k * 30)
    hats = rng.standard_normal(t.size) * 0.08 * (np.sin(2 * np.pi * 4 * t) > 0.6)
    bass = 0.3 * np.sin(2 * np.pi * 55 * t)
    y += drop * (kick + hats + bass + 0.15 * rng.standard_normal(t.size))
    # compression: loud parts squashed towards the quiet ones
    y = np.tanh(2.5 * y) / 2.5
    sf.write(str(path), y.astype(np.float32), SR)


def test_events_relative_to_the_song(tmp_path: Path) -> None:
    song = tmp_path / "song.wav"
    synth(song)
    segs = [{"key": "L1", "start_ms": 2000, "end_ms": 8000}, {"key": "G1", "start_ms": 10000, "end_ms": 16000, "sung": False}, {"key": "L2", "start_ms": 16500, "end_ms": 24000}, {"key": "L3", "start_ms": 27000, "end_ms": 31000}]
    (tmp_path / "segs.json").write_text(json.dumps(segs))
    out = tmp_path / "out.txt"
    import contextlib
    import io

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        assert music_cues.main([str(song), "--segments", str(tmp_path / "segs.json"), "--stems", "none"]) == 0
    r = json.loads(buf.getvalue().strip().splitlines()[-1])
    out.write_text(json.dumps(r, indent=1))
    assert r["stems"] == "bands"
    kinds = {(e["type"], round(e["at_ms"] / 1000)) for e in r["events"]}
    drops = [e for e in r["events"] if e["type"] == "drop"]
    assert drops and abs(drops[0]["at_ms"] - 16000) <= 1500, kinds
    assert any(e["type"] == "breakdown" and abs(e["at_ms"] - 26000) <= 1500 for e in r["events"]), kinds
    assert any(e["type"] == "build" and 8000 <= e["at_ms"] <= 14000 for e in r["events"]), kinds
    s = {x["key"]: x for x in r["segments"]}
    assert s["L1"]["level"] <= 2 and s["L1"]["density"] == "sparse"
    assert s["G1"]["trend"] == "rising"
    assert s["L2"]["level"] >= 4 and s["L2"]["density"] in ("medium", "full")
    assert s["L3"]["level"] <= 2


def test_percentiles_are_relative() -> None:
    x = np.array([-20.0, -19.0, -18.5, -18.0])  # a 2 dB range (a compressed master) still spans 0..1
    p = music_cues.pct(x)
    assert p[0] == 0 and p[-1] == 1 and np.all(np.diff(p) > 0)
