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


def test_pick_lead_is_the_karaoke_vocals() -> None:
    assert dereverb.pick_lead(["/t/a_(Instrumental)_k.wav", "/t/a_(Vocals)_k.wav"]).endswith("(Vocals)_k.wav")
    with pytest.raises(RuntimeError):
        dereverb.pick_lead(["/t/a.wav"])


def test_lead_stub_copies_and_never_touches_the_stem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    stem = tmp_path / "vocals.wav"
    stem.write_bytes(b"RIFF....WAVE")
    monkeypatch.setenv("LYRIC_DEREVERB_STUB", "1")
    out = tmp_path / "x-lead.wav"
    assert dereverb.main(["--lead", str(stem), str(out)]) == 0
    assert out.read_bytes() == stem.read_bytes() == b"RIFF....WAVE"


def test_models_are_the_chosen_ones() -> None:
    assert dereverb.DRY_MODEL == "dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt"
    assert dereverb.LEAD_MODEL == "bs_roformer_karaoke_anvuew.ckpt"


def test_stub_copies_and_never_touches_the_stem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    stem = tmp_path / "vocals.wav"
    stem.write_bytes(b"RIFF....WAVE")
    before = stem.read_bytes()
    monkeypatch.setenv("LYRIC_DEREVERB_STUB", "1")
    out = dereverb.dereverb(stem, tmp_path / ".studio" / "lipsync-audio" / "x-dereverb.wav")
    assert out.read_bytes() == before and stem.read_bytes() == before
