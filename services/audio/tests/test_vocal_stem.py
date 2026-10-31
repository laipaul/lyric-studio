"""The Suno vocal stem (vocals.wav): matched against the song, lined up, or rejected (then Demucs).
The song and the stem are only read: their content hash is the same before and after."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.cache import file_hash
from app.first_words import main as first_words_main
from app.vocal_stem import NOT_FOLLOWING, check_stem, lined_up_file, main, stem_argument, stem_track
from app.voice_map import main as voice_map_main
from tests.stems import SR, band, fade, mix, resample, stereo, voice

LENGTH = 100.0  # seconds of "Suno mix"


@pytest.fixture(scope="module")
def suno() -> dict[str, np.ndarray]:
    v = voice(LENGTH, seed=1)
    b = band(LENGTH)
    return {"voice": v, "band": b, "mix": mix(v, b)}


def write(path: Path, audio: np.ndarray, sr: int = SR) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), stereo(audio) if audio.ndim == 1 else audio, sr, subtype="PCM_24")
    return path


def song_and_stem(tmp: Path, song: np.ndarray, stem: np.ndarray, stem_sr: int = SR) -> tuple[Path, Path]:
    return write(tmp / "song" / "song.wav", song), write(tmp / "song" / "vocals.wav", stem, stem_sr)


def checked(tmp: Path, song: np.ndarray, stem: np.ndarray, stem_sr: int = SR):
    s, v = song_and_stem(tmp, song, stem, stem_sr)
    before = (file_hash(s), file_hash(v))
    m = check_stem(s, v, log=lambda _m: None)
    assert (file_hash(s), file_hash(v)) == before  # analysis only: never written
    return m


def test_identical_length_lines_up_without_offset(workspace: Path, tmp_path: Path, suno) -> None:
    m = checked(tmp_path, suno["mix"], suno["voice"])
    assert m.status == "lined-up" and abs(m.offset_ms) <= 2
    assert m.message == "Vocal stem lined up: it starts with the song (no offset)."
    assert len(m.points) >= 3


def test_trimmed_start_and_fades(workspace: Path, tmp_path: Path, suno) -> None:
    # song.wav: 1.8 s of silence cut at the start, the end trimmed and faded out.
    song = fade(suno["mix"][int(1.8 * SR) : -int(6 * SR)], 0.0, 3.0)
    m = checked(tmp_path, song, suno["voice"])
    assert m.status == "lined-up" and abs(m.offset_ms - 1800) <= 2
    assert m.message == "Vocal stem lined up: 1.8 s offset, from trimming the song's start."


def test_trimmed_end_only(workspace: Path, tmp_path: Path, suno) -> None:
    m = checked(tmp_path, suno["mix"][: -int(12 * SR)], suno["voice"])
    assert m.status == "lined-up" and abs(m.offset_ms) <= 2


def test_stem_starting_later_than_the_song(workspace: Path, tmp_path: Path, suno) -> None:
    song = np.concatenate([np.zeros(int(1.2 * SR), np.float32), suno["mix"]])
    m = checked(tmp_path, song, suno["voice"])
    assert m.status == "lined-up" and abs(m.offset_ms + 1200) <= 2


def test_other_sample_rate(workspace: Path, tmp_path: Path, suno) -> None:
    stem48 = resample(suno["voice"], SR, 48_000)
    m = checked(tmp_path, suno["mix"][int(0.7 * SR) :], stem48, stem_sr=48_000)
    assert m.status == "lined-up" and abs(m.offset_ms - 700) <= 2
    assert m.stem_rate == 48_000 and m.song_rate == SR


def test_middle_edit_is_rejected(workspace: Path, tmp_path: Path, suno) -> None:
    cut = np.concatenate([suno["mix"][: int(45 * SR)], suno["mix"][int(58 * SR) :]])
    m = checked(tmp_path, cut, suno["voice"])
    assert m.status == "rejected" and m.offset_ms is None
    assert m.message == NOT_FOLLOWING
    assert "does not stay the same" in m.reason


def test_repeated_part_is_rejected(workspace: Path, tmp_path: Path, suno) -> None:
    rep = np.concatenate([suno["mix"][: int(60 * SR)], suno["mix"][int(45 * SR) :]])
    m = checked(tmp_path, rep, suno["voice"])
    assert m.status == "rejected" and m.message == NOT_FOLLOWING


def test_another_version_is_rejected(workspace: Path, tmp_path: Path, suno) -> None:
    other = mix(voice(LENGTH, seed=5), suno["band"])  # the same band, another take of the voice
    m = checked(tmp_path, other, suno["voice"])
    assert m.status == "rejected" and m.message == NOT_FOLLOWING


def slowed(x: np.ndarray, sr: int) -> tuple[np.ndarray, float]:
    """x played at another speed (resampled to `sr`, played at SR) and the speed: stem time per song time."""
    y = resample(x, SR, sr)
    return y, len(x) / len(y)


def test_small_speed_difference_is_corrected(workspace: Path, tmp_path: Path, suno) -> None:
    slower, speed = slowed(suno["mix"], int(SR * 1.004))  # 0.4 % slower: 0.4 s off by the end
    m = checked(tmp_path, slower, suno["voice"])
    assert m.status == "lined-up" and abs(m.offset_ms) <= 5
    assert m.speed == pytest.approx(speed, abs=0.0002) and m.speed < 1
    assert "plays 0.4 % slower than the stem" in m.message


def test_speed_difference_of_the_real_song(workspace: Path, tmp_path: Path, suno) -> None:
    # Suno stem 48 kHz; the song: 0.66 s trimmed at the start, 0.2 % off, 44.1 kHz, faded end.
    stem48 = resample(suno["voice"], SR, 48_000)
    cut, speed = slowed(suno["mix"][int(0.66 * SR) :], int(SR * 0.998))
    song = fade(cut[: -int(4 * SR)], 0.0, 3.0)
    assert speed > 1.0019
    s, v = song_and_stem(tmp_path, song, stem48, 48_000)
    before = (file_hash(s), file_hash(v))
    lined, source = stem_track(s, v, log=lambda _m: None)
    assert (file_hash(s), file_hash(v)) == before
    m = check_stem(s, v, log=lambda _m: None)
    assert m.status == "lined-up" and m.speed == pytest.approx(speed, abs=0.0002)
    # stem time = offset + speed x song time: the 0.66 s cut off the song's start is the offset.
    assert abs(m.offset_ms - 660) <= 5 and "plays 0.2 % faster than the stem" in m.message
    assert lined is not None and source.kind == "stem" and source.speed == m.speed and source.label == "vocal stem, offset 0.7 s, speed corrected"
    assert lined == lined_up_file(file_hash(s), file_hash(v), m.offset_ms, m.speed) and "-x1.00" in lined.name
    audio, sr = sf.read(str(lined))
    assert sr == 16_000 and abs(len(audio) / sr - len(song) / SR) < 0.01
    # The voice as it is in the song (cut at 0.66 s, 0.2 % off), on the 16 kHz timeline: the copy matches it
    # at two song times (a lag of a few samples at most; a wrong speed would be 10 ms or more at 80 s).
    in_song = resample(resample(suno["voice"][int(0.66 * SR) :], SR, int(SR * 0.998)), SR, 16_000)
    for t in (30.0, 80.0):
        a = int(t * 16_000)
        piece, window = audio[a : a + 8_000], in_song[a - 64 : a + 8_000 + 64]
        corr = np.correlate(window, piece, mode="valid")
        lag = int(np.argmax(corr))
        assert abs(lag - 64) <= 48  # 3 ms
        assert corr[lag] / (np.linalg.norm(piece) * np.linalg.norm(window[lag : lag + 8_000])) > 0.95


def test_four_minute_song_with_a_speed_difference(workspace: Path, tmp_path: Path) -> None:
    # A whole 4-minute song 0.2 % off: the drift smears the whole-song peak (strength about 12), yet it lines up.
    v, b = voice(240.0, seed=3), band(240.0)
    song, speed = slowed(mix(v, b)[int(0.66 * SR) :], int(SR * 0.998))
    m = checked(tmp_path, song, v)
    assert m.status == "lined-up" and m.speed == pytest.approx(speed, abs=0.0002) and abs(m.offset_ms - 660) <= 5


def test_no_speed_in_the_normal_case(workspace: Path, tmp_path: Path, suno) -> None:
    m = checked(tmp_path, suno["mix"][int(1.8 * SR) :], suno["voice"])
    assert m.speed is None and "speed" not in m.message and "-x" not in lined_up_file("a", "b", m.offset_ms).name


def test_big_speed_difference_is_rejected(workspace: Path, tmp_path: Path, suno) -> None:
    slower, _ = slowed(suno["mix"], int(SR * 1.02))
    m = checked(tmp_path, slower, suno["voice"])
    assert m.status == "rejected" and m.speed is None and m.message == NOT_FOLLOWING


def test_middle_edit_with_speed_difference_is_rejected(workspace: Path, tmp_path: Path, suno) -> None:
    cut = np.concatenate([suno["mix"][: int(45 * SR)], suno["mix"][int(58 * SR) :]])
    slower, _ = slowed(cut, int(SR * 1.002))
    m = checked(tmp_path, slower, suno["voice"])
    assert m.status == "rejected" and m.speed is None and m.message == NOT_FOLLOWING


def test_silent_stem_is_rejected(workspace: Path, tmp_path: Path, suno) -> None:
    m = checked(tmp_path, suno["mix"], np.zeros_like(suno["voice"]))
    assert m.status == "rejected" and "silent" in m.message


def test_check_is_cached(workspace: Path, tmp_path: Path, suno) -> None:
    s, v = song_and_stem(tmp_path, suno["mix"], suno["voice"])
    first = check_stem(s, v, log=lambda _m: None)
    said: list[str] = []
    again = check_stem(s, v, log=said.append)
    assert not said and again == first  # from the cache: not compared again
    assert list((workspace / "cache" / "stems").glob("match-*.json"))


def test_lined_up_copy_is_on_the_song_timeline(workspace: Path, tmp_path: Path, suno) -> None:
    song = suno["mix"][int(1.8 * SR) : -int(6 * SR)]
    s, v = song_and_stem(tmp_path, song, suno["voice"])
    lined, source = stem_track(s, v, log=lambda _m: None)
    assert lined is not None and source.kind == "stem" and source.label == "vocal stem, offset 1.8 s"
    assert lined.parent == workspace / "cache" / "stems"  # analysis only, never next to the song
    audio, sr = sf.read(str(lined))
    assert sr == 16_000 and abs(len(audio) / sr - len(song) / SR) < 0.01  # exactly the song's length
    # The voice at song time t is the stem's voice at t + 1.8 s.
    ref = 0.985 * resample(suno["voice"], SR, 16_000)  # the stereo file read as mono: (1 + 0.97) / 2
    a = int(30 * 16_000)
    np.testing.assert_allclose(audio[a : a + 16_000], ref[a + int(1.8 * 16_000) : a + int(1.8 * 16_000) + 16_000], atol=2e-3)
    assert lined == lined_up_file(file_hash(s), file_hash(v), source.offset_ms)


def test_rejected_stem_falls_back_to_demucs(workspace: Path, tmp_path: Path, suno) -> None:
    cut = np.concatenate([suno["mix"][: int(45 * SR)], suno["mix"][int(58 * SR) :]])
    s, v = song_and_stem(tmp_path, cut, suno["voice"])
    said: list[str] = []
    lined, source = stem_track(s, v, log=said.append)
    assert lined is None and source.kind == "demucs" and source.message == NOT_FOLLOWING
    assert any("doesn't follow the song" in m for m in said)


def test_stem_argument(tmp_path: Path) -> None:
    song = tmp_path / "song.wav"
    assert stem_argument(song, "auto") is None  # no vocals.wav: Demucs
    (tmp_path / "vocals.wav").write_bytes(b"x")
    (tmp_path / "backing-vocals.wav").write_bytes(b"x")
    assert stem_argument(song, None) == tmp_path / "vocals.wav"  # never backing-vocals.wav
    assert stem_argument(song, "none") is None


def test_stem_argument_follows_the_link(tmp_path: Path) -> None:
    # The vocal stem under its own name, linked in .studio/files.json; vocals.wav is only the fallback.
    song = tmp_path / "These Empty Roads (Master).wav"
    (tmp_path / "vocals.wav").write_bytes(b"x")
    (tmp_path / "These Empty Roads (Lead Vocal).wav").write_bytes(b"x")
    (tmp_path / ".studio").mkdir()
    (tmp_path / ".studio" / "files.json").write_text(json.dumps({"version": 1, "vocals": "These Empty Roads (Lead Vocal).wav"}), encoding="utf-8")
    assert stem_argument(song, "auto") == tmp_path / "These Empty Roads (Lead Vocal).wav"
    (tmp_path / ".studio" / "files.json").write_text(json.dumps({"version": 1, "vocals": "../elsewhere.wav"}), encoding="utf-8")
    assert stem_argument(song, "auto") == tmp_path / "vocals.wav"  # never a path outside the folder


def test_voice_map_uses_the_lined_up_stem(workspace: Path, tmp_path: Path, suno) -> None:
    song = suno["mix"][int(1.8 * SR) :]
    s, v = song_and_stem(tmp_path, song, suno["voice"])
    before = file_hash(s)
    out = tmp_path / "voice.json"
    assert voice_map_main([str(s), "--out", str(out), "--stem", str(v)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["voice"]["kind"] == "stem" and data["voice"]["offset_ms"] == pytest.approx(1800, abs=2)
    assert abs(len(data["db"]) * 0.02 - len(song) / SR) < 0.1  # on the song's timeline
    # The first phrase of the voice starts at 2.0 s of the stem = 0.2 s of the song.
    first = next(i for i, d in enumerate(data["db"]) if d > -40) * 20
    assert 150 <= first <= 260
    assert file_hash(s) == before


def test_voice_map_without_stem_keeps_the_demucs_cache(workspace: Path, tmp_path: Path) -> None:
    song = write(tmp_path / "song.wav", np.zeros(SR, dtype=np.float32))
    stems = workspace / "cache" / "stems"
    stems.mkdir(parents=True)
    sf.write(str(stems / f"{file_hash(song)}-htdemucs-vocals.wav"), np.zeros(5 * 16_000, dtype=np.float32), 16_000)
    out = tmp_path / "voice.json"
    assert voice_map_main([str(song), "--out", str(out), "--stem", "none"]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["voice"]["kind"] == "demucs"


def test_first_words_uses_the_lined_up_stem(workspace: Path, tmp_path: Path, suno) -> None:
    s, v = song_and_stem(tmp_path, suno["mix"][int(1.8 * SR) :], suno["voice"])
    heard: list[int] = []

    def transcribe(audio: np.ndarray, _lang: str):
        heard.append(len(audio))
        return [("Hello", 1.0, 1.4, 0.7)]

    out = tmp_path / "words.json"
    assert first_words_main([str(s), "--windows", "[[1, 0, 10000]]", "--out", str(out), "--stem", str(v)], transcribe=transcribe) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["voice"]["kind"] == "stem"


def test_cli_writes_the_result(workspace: Path, tmp_path: Path, suno, capsys: pytest.CaptureFixture[str]) -> None:
    s, v = song_and_stem(tmp_path, suno["mix"][int(1.8 * SR) :], suno["voice"])
    out = tmp_path / "match.json"
    assert main([str(s), "--stem", str(v), "--out", str(out), "--line-up"]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["status"] == "lined-up" and Path(data["lined_up_file"]).exists()
    assert "Vocal stem lined up: 1.8 s offset" in capsys.readouterr().out
