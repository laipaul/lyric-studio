"""A de-reverbed copy of the vocal stem, for the lip-sync drafts only (26 Nov 2026, Lip-sync review step 2).

    python -m app.dereverb <stem.wav> <out.wav>

CLAUDE.md's exception, agreed with Paul: the copy lives in the song's .studio\\lipsync-audio\\ folder and is sent only
to the lip-sync model; the stem itself is never changed (only read here) and the copy never goes into any video or
any output. UVR "DeEcho-DeReverb" (VR architecture) through audio-separator, on the GPU when there is one; the model
downloads on first use into services/audio/models/uvr. LYRIC_DEREVERB_STUB=1: a plain copy stands in (tests).
"""
from __future__ import annotations

from . import ai_env  # noqa: F401  (must come first: model folders inside the project)

import os
import shutil
import sys
import tempfile
from pathlib import Path

from .ai_env import MODELS_DIR

MODEL = "UVR-DeEcho-DeReverb.pth"


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


def dereverb(stem: Path, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    if os.environ.get("LYRIC_DEREVERB_STUB"):
        shutil.copyfile(stem, out)
        return out
    from audio_separator.separator import Separator  # installed by pnpm audio:setup --dereverb

    with tempfile.TemporaryDirectory(prefix="lyric-dereverb-") as tmp:
        sep = Separator(output_dir=tmp, model_file_dir=str(MODELS_DIR / "uvr"), output_format="WAV")
        sep.load_model(model_filename=MODEL)
        files = [f if os.path.isabs(f) else os.path.join(tmp, f) for f in sep.separate(str(stem))]
        dry = pick_dry(files)
        part = out.with_suffix(".part.wav")
        shutil.copyfile(dry, part)
        os.replace(part, out)
    return out


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: python -m app.dereverb <stem.wav> <out.wav>", file=sys.stderr)
        return 2
    print(dereverb(Path(args[0]), Path(args[1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
