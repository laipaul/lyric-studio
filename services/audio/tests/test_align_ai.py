"""Real-model tests for pnpm align (marker "ai"): Demucs + WhisperX on CPU, English and French.

Needs the optional AI packages (pnpm audio:setup --ai), espeak-ng (to make the test song) and access
to the model downloads. Run with: pnpm test:audio -m ai

The test song is synthetic: a drum groove with spoken lyric lines (espeak-ng) placed at known times.
Real singing is harder; the real accuracy check is "pnpm align ... --compare" on a tapped song.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

pytestmark = pytest.mark.ai

torch = pytest.importorskip("torch")
pytest.importorskip("whisperx")
pytest.importorskip("demucs")

from app.ai_env import Device  # noqa: E402
from app.align import ALIGN_MODELS, align_words, chunked_model, separate_vocals, words_to_lines  # noqa: E402
from tests.synth import drum_track  # noqa: E402

SR = 44_100
TOLERANCE_MS = 150

LINES = {
    "en": ["The morning light is coming home", "We sing together all night long", "Hope is a good thing", "Never let it go"],
    "fr": ["La lumière du matin arrive", "Nous chantons ensemble toute la nuit", "L'espoir est une bonne chose", "Ça va très bien mon ami"],
}
STARTS_S = [2.0, 6.5, 11.0, 15.0]


def _speech_onset(audio: np.ndarray, sr: int) -> float:
    """Seconds of silence espeak puts before the first sound."""
    level = np.abs(audio)
    return float(np.argmax(level > level.max() * 0.05)) / sr


def make_song(path: Path, lang: str) -> list[int]:
    """Writes the test song and returns the true start (ms) of each spoken line."""
    if not shutil.which("espeak-ng"):
        pytest.skip("espeak-ng is needed to make the test song")
    groove = path.with_name("groove.wav")
    drum_track(groove, 100, bars=8, pickup_beats=0, lead_in_s=0.0, sr=SR)
    music, _ = sf.read(str(groove), dtype="float32")
    total = int(20 * SR)
    mix = np.zeros(total, dtype=np.float32)
    mix[: min(total, len(music))] += 0.35 * music[:total]
    truths = []
    for i, (text, start) in enumerate(zip(LINES[lang], STARTS_S)):
        voice = path.with_name(f"line{i}.wav")
        subprocess.run(["espeak-ng", "-v", lang, "-s", "140", "-w", str(voice), text], check=True)
        speech, sr = sf.read(str(voice), dtype="float32")
        if sr != SR:
            import librosa

            speech = librosa.resample(speech, orig_sr=sr, target_sr=SR)
        onset = _speech_onset(speech, SR)
        at = int(start * SR)
        mix[at : at + len(speech)] += 0.9 * speech[: total - at]
        truths.append(round((start + onset) * 1000))
    mix /= np.abs(mix).max() * 1.05
    sf.write(str(path), np.stack([mix, mix], axis=1), SR)
    return truths


@pytest.mark.parametrize("lang", ["en", "fr"])
def test_aligns_lines_within_150_ms(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, lang: str) -> None:
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "workspace"))
    song = tmp_path / f"song-{lang}.wav"
    truths = make_song(song, lang)
    log = lambda m: print(m)  # noqa: E731
    device = Device("cpu", "CPU (test)")

    vocals, _ = separate_vocals(song, device, log)
    assert vocals.exists()
    cached, _ = separate_vocals(song, device, log)  # second time: from the cache
    assert cached == vocals

    texts = LINES[lang]
    words, _ = align_words(vocals, " ".join(texts), lang, ALIGN_MODELS[lang], device, log)
    lines = words_to_lines(texts, [False] * len(texts), words)
    for line, truth in zip(lines, truths):
        print(f"{lang}: {line.text!r}: aligned {line.start_ms} ms, true {truth} ms, confidence {line.confidence:.2f}")
    for line, truth in zip(lines, truths):
        assert abs(line.start_ms - truth) <= TOLERANCE_MS, f"{line.text}: {line.start_ms} vs {truth}"
        assert line.confidence > 0.3


def test_chunked_model_matches_the_whole_audio() -> None:
    """Processing long audio in windows gives the same frames as processing it at once (for a model
    with wav2vec2's framing: one frame per 320 samples, 400-sample receptive field)."""

    class FakeWav2Vec2(torch.nn.Module):
        def forward(self, x):
            frames = (x.shape[-1] - 400) // 320 + 1
            feats = torch.stack([x[0, k * 320 : k * 320 + 400].mean() for k in range(frames)])
            return feats[None, :, None].repeat(1, 1, 3), None

    audio = torch.randn(1, 16_000 * 75)  # 75 s: three 30 s windows
    whole, _ = FakeWav2Vec2()(audio)
    chunked, _ = chunked_model(FakeWav2Vec2(), "torchaudio", chunk_s=30, context_s=2)(audio)
    assert chunked.shape[1] == -(-audio.shape[-1] // 320)  # one frame per 20 ms
    n = whole.shape[1]
    assert torch.allclose(chunked[:, : n - 1], whole[:, : n - 1])
