"""Command line: pnpm analyze <path-to-audio> [--bpm 140] [--downbeat-offset 1] [--click] [--json]

Analyses any audio file on this PC (it does not need "pnpm dev" running) and prints the result.
Results are cached in the workspace, like the /analyze endpoint."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analysis import MAX_BPM, MIN_BPM
from .beatgrid import apply_downbeat_offset, write_click_track
from .cache import analyze_cached
from .store import DatabaseOutdated, find_project_by_audio, set_downbeat_offset

FIRST_BEATS = 16


def _clock(ms: int) -> str:
    minutes, rest = divmod(ms, 60_000)
    return f"{minutes}:{rest / 1000:06.3f}"


def _confidence_label(value: float) -> str:
    if value >= 0.4:
        return "high"
    if value >= 0.15:
        return "medium"
    return "low - downbeats are a guess"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pnpm analyze", description="Find BPM, beats and downbeats of a song.")
    parser.add_argument("path", help="audio file (WAV, MP3, FLAC, ...)")
    parser.add_argument("--bpm", type=float, help=f"manual BPM ({MIN_BPM:g}-{MAX_BPM:g}): re-track beats around this tempo")
    parser.add_argument(
        "--downbeat-offset", type=int, choices=[0, 1, 2, 3], help="bar 1 starts this many beats later than detected"
    )
    parser.add_argument("--click", action="store_true", help="write <song>_click.wav with clicks on the beats")
    parser.add_argument("--json", action="store_true", help="print the full result as JSON")
    parser.add_argument("--cwd", help=argparse.SUPPRESS)  # folder the user ran pnpm from
    args = parser.parse_args(argv)

    path = Path(args.path)
    if not path.is_absolute() and args.cwd:
        path = Path(args.cwd) / path
    path = path.resolve()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1
    if args.bpm is not None and not (MIN_BPM <= args.bpm <= MAX_BPM):
        print(f"--bpm must be between {MIN_BPM:g} and {MAX_BPM:g}", file=sys.stderr)
        return 1

    try:
        r = analyze_cached(path, bpm=args.bpm)
    except Exception as error:
        print(f"Could not analyse {path}: {error}", file=sys.stderr)
        return 1

    # Downbeat offset: from --downbeat-offset, else the project's saved value if this is a project's song.
    try:
        project = find_project_by_audio(path)
    except DatabaseOutdated as error:
        print(f"Note: {error}; project settings are ignored for this run.", file=sys.stderr)
        project = None
    offset_note = ""
    offset = args.downbeat_offset
    if project and offset is not None:
        set_downbeat_offset(project["id"], offset)
        offset_note = f"saved to project \"{project['title']}\""
    elif project:
        offset = project["downbeat_offset"]
        offset_note = f"from project \"{project['title']}\""
    offset = offset or 0
    r = {**r, "beats": apply_downbeat_offset(r["beats"], offset), "downbeat_offset": offset}

    click_file = write_click_track(path, r["beats"]) if args.click else None

    if args.json:
        print(json.dumps({**r, "path": str(path), "click_file": str(click_file) if click_file else None}, indent=2))
        return 0

    alt = r["bpm_alternatives"]
    beats = r["beats"]
    downbeats = sum(1 for b in beats if b["is_downbeat"])
    source = "set manually" if r["bpm_source"] == "manual" else "detected"
    quoted = f'"{path}"'

    print(f"File:        {path}")
    print(f"Duration:    {_clock(r['duration_ms'])}  ({r['duration_ms']} ms)")
    print(f"BPM:         {r['bpm']:g}  ({source})")
    print(f"Half/double: {alt['half']:g} / {alt['double']:g}")
    print(f"             If the beat feels too fast or too slow, try: pnpm analyze {quoted} --bpm {alt['half']:g}")
    print(f"                                                      or: pnpm analyze {quoted} --bpm {alt['double']:g}")
    print(f"Downbeats:   confidence {r['downbeat_confidence']:.2f} ({_confidence_label(r['downbeat_confidence'])})")
    print(f"             offset {offset}{f' ({offset_note})' if offset_note else ''}"
          f" - if bar 1 sounds wrong, change it with --downbeat-offset 0, 1, 2 or 3")
    print(f"Beats:       {len(beats)} beats, {downbeats} downbeats (bars){'   [from cache]' if r['cached'] else ''}")
    print()
    print(f"First {min(FIRST_BEATS, len(beats))} beats:")
    print("    #   time        strength")
    bar = 0
    for i, b in enumerate(beats[:FIRST_BEATS], start=1):
        mark = ""
        if b["is_downbeat"]:
            bar += 1
            mark = f"  <== DOWNBEAT (bar {bar})"
        print(f"  {i:>3}   {_clock(b['time_ms'])}   {b['strength']:.2f}{mark}")
    if click_file:
        print()
        print(f"Click track: {click_file}")
        print("             high click = bar 1 (downbeat), low click = other beats")
    return 0


if __name__ == "__main__":
    sys.exit(main())
