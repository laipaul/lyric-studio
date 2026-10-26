"""pnpm align: everything that does not need the AI packages (LRC output, word mapping, compare,
output path safety, device choice). The real-model test is tests/test_align_ai.py (marker "ai")."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.ai_env import Device, choose_device, with_cpu_fallback
from app.align import LOW_CONFIDENCE, match_words, output_path, print_lines, words_to_lines
from app.compare import compare
from app.lrc import AlignedLine, Word, build_lrc, normalize_lyric, parse_lrc
from app.tap import parse_lyrics_txt


def _line(text: str, start: int, step: int = 300, score: float = 0.9, hook: bool = False) -> AlignedLine:
    words = [Word(w, start + i * step, start + i * step + step - 50, score) for i, w in enumerate(text.split())]
    return AlignedLine(text=text, is_hook=hook, words=words)


def test_writes_enhanced_lrc_with_hooks_pauses_and_end() -> None:
    a = _line("First line here", 1_000)
    b = _line("Hope is good", 3_000, hook=True)
    c = _line("After the break", 9_000)
    lrc = build_lrc([("line", a), ("line", b), ("pause", None), ("line", c)], duration_ms=20_000, header=["[ar:Life Lyrics]"])
    assert lrc.splitlines() == [
        "[ar:Life Lyrics]",
        "[00:01.00]<00:01.00>First <00:01.30>line <00:01.60>here <00:01.85>",  # last tag: where "here" ends
        "[00:03.00]* <00:03.00>Hope <00:03.30>is <00:03.60>good <00:03.85>",
        "[00:04.15]",  # pause: 0.3 s after the last word of "Hope is good" (ends 3.85 s)
        "[00:09.00]<00:09.00>After <00:09.30>the <00:09.60>break <00:09.85>",
        "[00:10.35]",  # end of the last line: 0.5 s after its last word
    ]
    parsed = parse_lrc(lrc)
    assert [(l.start_ms, l.text, l.is_hook) for l in parsed] == [
        (1_000, "First line here", False),
        (3_000, "Hope is good", True),
        (9_000, "After the break", False),
    ]
    assert parsed[1].words == [(3_000, "Hope"), (3_300, "is"), (3_600, "good")]
    assert [l.end_ms for l in parsed] == [1_850, 3_850, 9_850]  # read back from the trailing tags
    assert parse_lrc("[00:01.00]<00:01.00>Old <00:01.40>style\n")[0].end_ms is None


def test_pause_never_lands_after_the_next_line() -> None:
    a = _line("One", 1_000)
    b = _line("Two", 1_400)  # starts right after
    lrc = build_lrc([("line", a), ("pause", None), ("line", b)], duration_ms=5_000)
    pause = lrc.splitlines()[1]
    assert pause == "[00:01.30]"  # would be 1.55 s, capped at 0.1 s before "Two" (1.4 s)


def test_words_are_mapped_to_lines_and_gaps_filled() -> None:
    texts = ["Hello there", "Ça va bien"]
    words = [
        {"word": "Hello", "start": 1.0, "end": 1.4, "score": 0.9},
        {"word": "there", "start": 1.5, "end": 1.9, "score": 0.8},
        {"word": "Ça"},  # not placed by the model: takes the previous word's end, score 0
        {"word": "va", "start": 2.6, "end": 2.8, "score": 0.7},
        {"word": "bien", "start": 2.9, "end": 3.3, "score": 0.9},
    ]
    lines = words_to_lines(texts, [False, True], words)
    assert [l.start_ms for l in lines] == [1_000, 1_900]
    assert lines[1].is_hook and lines[1].words[0].score == 0.0
    assert lines[1].confidence == pytest.approx((0 + 0.7 + 0.9) / 3)


def test_word_count_mismatch_falls_back_to_matching_by_text() -> None:
    flat = ["Love", "is", "a", "good", "thing"]
    words = [{"word": "Love", "start": 1.0}, {"word": "is", "start": 1.2}, {"word": "good", "start": 1.6}, {"word": "thing", "start": 1.9}]
    matched = match_words(flat, words)
    assert [w.get("start") for w in matched] == [1.0, 1.2, None, 1.6, 1.9]


def test_compare_reports_differences_offset_and_shift() -> None:
    aligned = [_line(t, s) for t, s in [("One line", 1_000), ("Two lines", 3_000), ("Extra line", 4_000), ("Three", 6_000), ("Four", 8_000)]]
    reference = parse_lrc("[00:01.20]One line\n[00:03.25]Two lines!\n[00:05.00]Only tapped\n[00:06.10]three\n[00:08.90]Four\n")
    c = compare(aligned, reference)
    assert [(r.number, r.diff_ms) for r in c.rows] == [(1, -200), (2, -250), (4, -100), (5, -900)]
    assert c.missing_in_reference == ["Extra line"]
    assert c.missing_in_alignment == ["Only tapped"]
    assert c.median_abs_ms == 225
    assert c.typical_offset_ms == -225  # the taps are ~0.23 s late
    assert c.shift_suggestion_s == pytest.approx(-0.25)
    assert [r.number for r in c.worst(2)] == [5, 2]
    assert c.tapped_for(4) == 6_100 and c.tapped_for(3) is None


def test_low_confidence_lines_show_the_tapped_time(capsys: pytest.CaptureFixture[str]) -> None:
    aligned = [_line("Clear line", 1_000), _line("Mumbled line", 3_000, score=0.2)]
    c = compare(aligned, parse_lrc("[00:01.10]Clear line\n[00:02.70]Mumbled line\n"))
    print_lines(aligned, c)
    out = capsys.readouterr().out
    mumbled = next(l for l in out.splitlines() if "Mumbled line" in l)
    assert "00:03.00" in mumbled and "(tapped 00:02.70)" in mumbled and "low confidence" in mumbled
    assert "low confidence" not in next(l for l in out.splitlines() if "Clear line" in l)
    assert f"below {LOW_CONFIDENCE}" in out


def test_never_overwrites_the_reference(tmp_path: Path) -> None:
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("x")
    assert output_path(lyrics, None, None, tmp_path) == tmp_path / "lyrics.lrc"
    # Windows: Lyrics.lrc and lyrics.lrc are the same file.
    reference = tmp_path / "Lyrics.lrc"
    reference.write_text("[00:01.00]x\n")
    assert output_path(lyrics, None, reference, tmp_path) == tmp_path / "lyrics.aligned.lrc"
    assert output_path(lyrics, "Lyrics.lrc", reference, tmp_path) == tmp_path / "lyrics.aligned.lrc"
    other = tmp_path / "taps.lrc"
    other.write_text("[00:01.00]x\n")
    assert output_path(lyrics, None, other, tmp_path) == tmp_path / "lyrics.lrc"


def test_lyrics_txt_is_read_like_pnpm_tap() -> None:
    items = parse_lyrics_txt("Verse one\n* Hope is a good thing\n\nVerse two\n")
    assert [(i.kind, i.text) for i in items] == [("line", "Verse one"), ("line", "* Hope is a good thing"), ("pause", ""), ("line", "Verse two"), ("end", "")]
    assert normalize_lyric("* Hope, is a GOOD thing!") == "hope is a good thing"


class _FakeCuda:
    def __init__(self, available: bool, fails: bool = False):
        self._available, self._fails = available, fails

    def is_available(self) -> bool:
        return self._available

    def get_device_capability(self, _i: int):
        return (12, 0)

    def get_device_name(self, _i: int) -> str:
        return "NVIDIA GeForce RTX 5060 Laptop GPU"


class _FakeTensor:
    def __init__(self, fails: bool):
        self.fails = fails

    def __mul__(self, _other):
        if self.fails:
            raise RuntimeError("CUDA error: no kernel image is available for execution on the device\nmore")
        return self

    def sum(self):
        return self

    def item(self):
        return 16.0


def _torch(available: bool, cuda_version: str | None = "12.8", fails: bool = False):
    return SimpleNamespace(
        cuda=_FakeCuda(available),
        version=SimpleNamespace(cuda=cuda_version),
        ones=lambda *a, **k: _FakeTensor(fails),
    )


def test_device_choice_and_messages() -> None:
    gpu = choose_device(_torch(True))
    assert gpu.is_gpu and gpu.description == "GPU: NVIDIA GeForce RTX 5060 Laptop GPU (CUDA 12.8, compute 12.0)"
    assert choose_device(_torch(True), "cpu").description == "CPU (chosen with --device cpu)"
    assert choose_device(_torch(False, cuda_version=None)).description == "CPU (this PyTorch build has no CUDA support)"
    assert choose_device(_torch(False)).description == "CPU (no NVIDIA GPU / driver found)"
    broken = choose_device(_torch(True, fails=True))
    assert not broken.is_gpu and "no kernel image" in broken.description
    with pytest.raises(RuntimeError):
        choose_device(_torch(False), "cuda")


def test_gpu_failure_retries_on_cpu() -> None:
    calls: list[str] = []
    messages: list[str] = []

    def run(device: str) -> str:
        calls.append(device)
        if device == "cuda":
            raise RuntimeError("CUDA out of memory\ndetails")
        return "done"

    result, device = with_cpu_fallback(Device("cuda", "GPU"), "Alignment", run, messages.append)
    assert (result, device.name, calls) == ("done", "cpu", ["cuda", "cpu"])
    assert messages == ["Alignment failed on the GPU (CUDA out of memory); retrying on the CPU"]


def test_trim_switch() -> None:
    from app.align import build_parser

    assert build_parser().parse_args(["s.wav", "l.txt"]).trim == "on"
    assert build_parser().parse_args(["s.wav", "l.txt", "--trim", "off"]).trim == "off"
    with pytest.raises(SystemExit):
        build_parser().parse_args(["s.wav", "l.txt", "--trim", "maybe"])


def test_report_has_confidence_and_sung_times_per_line() -> None:
    from app.align import build_parser, line_report

    a = _line("First line here", 1_000, score=0.9)
    b = _line("Hope is good", 3_000, score=0.4, hook=True)
    report = line_report([a, b], "MODEL", "en")
    assert report["low_confidence"] == LOW_CONFIDENCE
    assert report["lines"] == [
        {"number": 1, "text": "First line here", "is_hook": False, "start_ms": 1_000, "end_ms": 1_850, "confidence": 0.9,
         "words": [{"text": "First", "start_ms": 1_000, "end_ms": 1_250}, {"text": "line", "start_ms": 1_300, "end_ms": 1_550},
                   {"text": "here", "start_ms": 1_600, "end_ms": 1_850}]},
        {"number": 2, "text": "Hope is good", "is_hook": True, "start_ms": 3_000, "end_ms": 3_850, "confidence": 0.4,
         "words": [{"text": "Hope", "start_ms": 3_000, "end_ms": 3_250}, {"text": "is", "start_ms": 3_300, "end_ms": 3_550},
                   {"text": "good", "start_ms": 3_600, "end_ms": 3_850}]},
    ]
    args = build_parser().parse_args(["s.wav", "l.txt", "--report", "r.json", "--fresh"])
    assert (args.report, args.fresh) == ("r.json", True)
    assert build_parser().parse_args(["s.wav", "l.txt"]).fresh is False


def test_write_atomic_replaces_whole_file_and_leaves_no_part(tmp_path):
    from app.align import write_atomic

    target = tmp_path / "out.lrc"
    target.write_text("old", encoding="utf-8")
    write_atomic(target, "[00:01.00]new\n")
    assert target.read_text(encoding="utf-8") == "[00:01.00]new\n"
    assert [p.name for p in tmp_path.iterdir()] == ["out.lrc"]  # no .part left behind
