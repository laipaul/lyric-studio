"""The de-reverb for the lip-sync drafts (26 Nov 2026): which output is the dry vocal, and the stand-in copy (the real
UVR model runs on the PC after pnpm audio:setup --dereverb)."""
from pathlib import Path

import pytest

from app import dereverb


def test_pick_dry_by_name() -> None:
    assert dereverb.pick_dry(["/t/stem_(Reverb)_UVR.wav", "/t/stem_(No Reverb)_UVR.wav"]).endswith("(No Reverb)_UVR.wav")
    assert dereverb.pick_dry(["/t/a_(Echo).wav", "/t/a_(No Echo).wav"]).endswith("(No Echo).wav")
    assert dereverb.pick_dry(["/t/a_(Reverb).wav", "/t/a_(Vocals).wav"]).endswith("(Vocals).wav")
    with pytest.raises(RuntimeError):
        dereverb.pick_dry(["/t/a.wav", "/t/b.wav"])


def test_stub_copies_and_never_touches_the_stem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    stem = tmp_path / "vocals.wav"
    stem.write_bytes(b"RIFF....WAVE")
    before = stem.read_bytes()
    monkeypatch.setenv("LYRIC_DEREVERB_STUB", "1")
    out = dereverb.dereverb(stem, tmp_path / ".studio" / "lipsync-audio" / "x-dereverb.wav")
    assert out.read_bytes() == before and stem.read_bytes() == before
