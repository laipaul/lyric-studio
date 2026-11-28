"""The dry vocal for lips: copies of the vocal stem for the lip-sync model only (26 Nov 2026, Lip-sync review step 2;
models chosen 28 Nov 2026).

    python -m app.dereverb <stem.wav> <out.wav>            the dry vocal (the reverb removed)
    python -m app.dereverb --lead <stem.wav> <out.wav>     the lead vocal only (backing vocals removed), then dry

CLAUDE.md's exception, agreed with Paul: the copies live in the song's .studio\\lipsync-audio\\ folder and are sent only
to the lip-sync model; the stem itself is never changed (only read here) and the copies never go into any video or
any output. Through audio-separator (pnpm audio:setup --dereverb), on the GPU when there is one; each model downloads
on first use into services/audio/models/uvr. Chosen on Wedding Day's stem, 28 Nov 2026 (RTX 5060 laptop):
  - de-reverb: anvuew's MelBand RoFormer (GPL-3.0): the pauses 40 dB quieter (UVR DeEcho-DeReverb: 22 dB), the singing
    kept; 25 s per minute of vocal;
  - lead only: anvuew's BS RoFormer karaoke (GPL-3.0); 41 s per minute of vocal, then the de-reverb.
LYRIC_DEREVERB_STUB=1: a plain copy stands in (tests).
"""
from __future__ import annotations

from . import ai_env  # noqa: F401  (must come first: model folders inside the project)

import os
import shutil
import sys
import tempfile
from pathlib import Path

from .ai_env import MODELS_DIR

DRY_MODEL = "dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt"
LEAD_MODEL = "bs_roformer_karaoke_anvuew.ckpt"


def pick_dry(files: list[str]) -> str:
    """The output without the reverb: named "No Reverb" / "No Echo" / "Dry" (depending on the model's stem names), else
    the one that does not say Reverb or Echo."""
    for key in ("no reverb", "noreverb", "no echo", "dry"):
        for f in files:
            if key in Path(f).name.lower():
                return f
    rest = [f for f in files if not any(k in Path(f).name.lower() for k in ("reverb", "echo"))]
    if len(rest) == 1:
        return rest[0]
    raise RuntimeError(f"could not tell the dry vocal among {', '.join(Path(f).name for f in files)}")


def pick_lead(files: list[str]) -> str:
    """The karaoke model's "Vocals" output is the lead (its "Instrumental" holds the backing vocals)."""
    for f in files:
        if "(vocals)" in Path(f).name.lower():
            return f
    raise RuntimeError(f"could not tell the lead vocal among {', '.join(Path(f).name for f in files)}")


def _separate(model: str, audio: str, tmp: str) -> list[str]:
    from audio_separator.separator import Separator  # installed by pnpm audio:setup --dereverb

    sep = Separator(output_dir=tmp, model_file_dir=str(MODELS_DIR / "uvr"), output_format="WAV")
    sep.load_model(model_filename=model)
    return [f if os.path.isabs(f) else os.path.join(tmp, f) for f in sep.separate(audio)]


def dereverb(stem: Path, out: Path, lead: bool = False) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    if os.environ.get("LYRIC_DEREVERB_STUB"):
        shutil.copyfile(stem, out)
        return out
    with tempfile.TemporaryDirectory(prefix="lyric-dereverb-") as tmp:
        source = str(stem)
        if lead:
            lead_dir = os.path.join(tmp, "lead")
            os.makedirs(lead_dir)
            source = pick_lead(_separate(LEAD_MODEL, source, lead_dir))
        dry_dir = os.path.join(tmp, "dry")
        os.makedirs(dry_dir)
        dry = pick_dry(_separate(DRY_MODEL, source, dry_dir))
        part = out.with_suffix(".part.wav")
        shutil.copyfile(dry, part)
        os.replace(part, out)
    return out


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    lead = "--lead" in args
    args = [a for a in args if a != "--lead"]
    if len(args) != 2:
        print("usage: python -m app.dereverb [--lead] <stem.wav> <out.wav>", file=sys.stderr)
        return 2
    print(dereverb(Path(args[0]), Path(args[1]), lead))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
