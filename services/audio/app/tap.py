"""pnpm tap <song> <lyrics.txt> [--section 0:11-0:59] [--shift -0.15]

--shift defaults to -0.15 s to compensate for typical human reaction time (taps come slightly late).

Plays the section; press Enter at the start of each lyric line. Writes <lyrics>.lrc next to the
.txt. Backspace = redo the last stamp, r = restart the section, q = quit without saving.

A blank line in lyrics.txt is a pause: tapping it ends the previous line (for instrumental gaps).
After the last line, one more Enter marks where it ends.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- pure logic (tested)


@dataclass
class TapItem:
    kind: str  # "line" | "pause" | "end"
    text: str = ""
    file_line: int = 0  # line number in lyrics.txt (1-based), 0 for the end marker

    def label(self) -> str:
        if self.kind == "line":
            return self.text
        return "(pause - ends the previous line)" if self.kind == "pause" else "(end of the last line)"


def parse_lyrics_txt(content: str) -> list[TapItem]:
    """Lyric lines and pauses (blank lines between lyrics; repeated blanks count once), plus the end marker."""
    items: list[TapItem] = []
    for number, raw in enumerate(content.splitlines(), start=1):
        text = raw.strip()
        if text:
            items.append(TapItem("line", text, number))
        elif items and items[-1].kind == "line":
            items.append(TapItem("pause", "", number))
    while items and items[-1].kind == "pause":
        items.pop()
    if not any(i.kind == "line" for i in items):
        raise ValueError("the lyrics file has no lines")
    items.append(TapItem("end"))
    return items


def format_time(ms: int) -> str:
    total = max(0, round(ms / 10))  # centiseconds
    return f"[{total // 6000:02d}:{(total % 6000) / 100:05.2f}]"


@dataclass
class TapSession:
    items: list[TapItem]
    stamps: list[int] = field(default_factory=list)  # song time in ms, one per tapped item

    @property
    def done(self) -> bool:
        return len(self.stamps) == len(self.items)

    @property
    def next_item(self) -> TapItem | None:
        return None if self.done else self.items[len(self.stamps)]

    def tap(self, ms: int) -> TapItem | None:
        if self.done:
            return None
        ms = max(ms, self.stamps[-1] + 1 if self.stamps else 0)  # stamps never go backwards
        self.stamps.append(ms)
        return self.items[len(self.stamps) - 1]

    def undo(self) -> tuple[TapItem, int] | None:
        if not self.stamps:
            return None
        ms = self.stamps.pop()
        return self.items[len(self.stamps)], ms

    def restart(self) -> None:
        self.stamps.clear()

    def to_lrc(self, artist: str = "Life Lyrics") -> str:
        out = [f"[ar:{artist}]", "[re:Lyric Studio - pnpm tap]"]
        for item, ms in zip(self.items, self.stamps):
            out.append(f"{format_time(ms)}{item.text if item.kind == 'line' else ''}")
        return "\n".join(out) + "\n"


ENTER, BACKSPACE, RESTART, QUIT = "enter", "backspace", "restart", "quit"


def normalise_key(char: str) -> str | None:
    if char in ("\r", "\n"):
        return ENTER
    if char in ("\x08", "\x7f"):
        return BACKSPACE
    if char.lower() == "r":
        return RESTART
    if char.lower() == "q" or char == "\x03":
        return QUIT
    return None


def handle_key(session: TapSession, key: str, song_ms: int) -> str:
    """Applies a key and returns the line to print."""
    if key == ENTER:
        item = session.tap(song_ms)
        if item is None:
            return ""
        return f"  {format_time(session.stamps[-1])}  {item.label()}"
    if key == BACKSPACE:
        undone = session.undo()
        if undone is None:
            return "  (nothing to undo)"
        item, ms = undone
        return f"  undone {format_time(ms)}  {item.label()}  - tap it again"
    if key == RESTART:
        session.restart()
        return "  restarting the section - all stamps cleared"
    return ""


def position_ms(records: list[tuple[float, int]], now: float, sample_rate: int) -> int | None:
    """Playback position (ms into the section) at clock time `now`, from (dac_time, frame) pairs: the
    time each audio buffer reaches the speakers and the section frame it starts with."""
    best = None
    for dac_time, frame in records:
        if dac_time <= now:
            best = (dac_time, frame)
        else:
            break
    if best is None:
        return 0 if records else None
    dac_time, frame = best
    return int(round((frame + (now - dac_time) * sample_rate) / sample_rate * 1000))


def parse_clock(text: str) -> int:
    parts = text.strip().split(":")
    if len(parts) > 2:
        raise ValueError(f'not a time: "{text}"')
    seconds = float(parts[0]) * 60 + float(parts[1]) if len(parts) == 2 else float(parts[0])
    return int(round(seconds * 1000))


# --------------------------------------------------------------------------- audio + keyboard


class SectionPlayer:
    """Plays a section through the sound card and reports what is being heard right now."""

    def __init__(self, audio, sample_rate: int):
        import sounddevice as sd  # imported here so the pure logic above works without audio libraries

        self.audio = audio
        self.sample_rate = sample_rate
        self.pos = 0
        self.finished = False
        self.lock = threading.Lock()
        self.records: deque[tuple[float, int]] = deque(maxlen=4000)
        self.stream = sd.OutputStream(
            samplerate=sample_rate, channels=audio.shape[1], dtype="float32", callback=self._callback, latency="low"
        )

    def _callback(self, outdata, frames, time_info, status) -> None:
        with self.lock:
            chunk = self.audio[self.pos : self.pos + frames]
            outdata[: len(chunk)] = chunk
            outdata[len(chunk) :] = 0
            dac = time_info.outputBufferDacTime
            if not dac:  # some Windows drivers do not report it
                dac = time_info.currentTime + self.stream.latency
            self.records.append((dac, self.pos))
            self.pos += len(chunk)
            if len(chunk) < frames:
                self.finished = True

    def start(self) -> None:
        self.stream.start()

    def restart(self) -> None:
        with self.lock:
            self.pos = 0
            self.finished = False
            self.records.clear()

    def now_ms(self) -> int:
        with self.lock:
            records = list(self.records)
        heard = position_ms(records, self.stream.time, self.sample_rate)
        return min(heard or 0, int(len(self.audio) / self.sample_rate * 1000))

    def heard_end(self) -> bool:
        return self.finished and self.now_ms() >= int(len(self.audio) / self.sample_rate * 1000) - 5

    def close(self) -> None:
        self.stream.stop()
        self.stream.close()


class KeyReader:
    """Single key presses without Enter-buffering, on Windows and macOS/Linux."""

    def __enter__(self):
        if os.name != "nt":
            import termios
            import tty

            self.fd = sys.stdin.fileno()
            self.old = termios.tcgetattr(self.fd)
            tty.setcbreak(self.fd)
        return self

    def __exit__(self, *exc):
        if os.name != "nt":
            import termios

            termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old)

    def read(self) -> str | None:
        if os.name == "nt":
            import msvcrt

            if msvcrt.kbhit():
                char = msvcrt.getwch()
                if char in ("\x00", "\xe0"):  # arrow / function keys: ignore
                    msvcrt.getwch()
                    return None
                return char
            return None
        import select

        if select.select([sys.stdin], [], [], 0)[0]:
            return sys.stdin.read(1)
        return None


# Taps come late by roughly a human reaction time; stamps are moved this much earlier by default.
DEFAULT_SHIFT_SECONDS = -0.15


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pnpm tap", description="Tap the start of each lyric line while the song plays.")
    parser.add_argument("song")
    parser.add_argument("lyrics", help='lyrics.txt: one lyric line per line, blank line = pause, "* " = hook')
    parser.add_argument("--section", help="part of the song to play, e.g. 0:11-0:59 (default: whole song)")
    parser.add_argument(
        "--shift",
        type=float,
        default=DEFAULT_SHIFT_SECONDS,
        help=f"move all stamps by this many seconds (default {DEFAULT_SHIFT_SECONDS}, reaction time)",
    )
    parser.add_argument("--cwd", help=argparse.SUPPRESS)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    def resolve(p: str) -> Path:
        path = Path(p)
        return (Path(args.cwd) / path if not path.is_absolute() and args.cwd else path).resolve()

    song, lyrics = resolve(args.song), resolve(args.lyrics)
    for f in (song, lyrics):
        if not f.is_file():
            print(f"File not found: {f}", file=sys.stderr)
            return 1
    try:
        items = parse_lyrics_txt(lyrics.read_text(encoding="utf-8-sig"))
    except ValueError as error:
        print(f"{lyrics}: {error}", file=sys.stderr)
        return 1

    import soundfile as sf

    audio, sr = sf.read(str(song), always_2d=True, dtype="float32")
    total_ms = int(len(audio) / sr * 1000)
    start_ms, end_ms = 0, total_ms
    if args.section:
        try:
            a, b = args.section.split("-")
            start_ms, end_ms = parse_clock(a), min(parse_clock(b), total_ms)
        except ValueError:
            print("--section must look like 0:11-0:59", file=sys.stderr)
            return 1
        if end_ms <= start_ms:
            print("The section must end after it starts.", file=sys.stderr)
            return 1
    section = audio[int(start_ms / 1000 * sr) : int(end_ms / 1000 * sr)]
    shift_ms = int(round(args.shift * 1000))

    session = TapSession(items)
    out = lyrics.with_suffix(".lrc")
    lines = sum(1 for i in items if i.kind == "line")
    print(f"Song:    {song}")
    print(f"Section: {format_time(start_ms)[1:-1]} - {format_time(end_ms)[1:-1]}   Lyrics: {lines} lines from {lyrics.name}")
    print("Keys:    Enter = stamp the next line   Backspace = redo the last stamp   r = restart   q = quit")
    print(f"Shift:   stamps are moved {args.shift:+.2f} s (reaction time; change with --shift)")
    print()
    print(f"Next: {session.next_item.label()}")

    if not sys.stdin.isatty():
        print("pnpm tap needs an interactive terminal (it reads single key presses).", file=sys.stderr)
        return 1
    try:
        player = SectionPlayer(section, sr)
    except Exception as error:  # no sound device / PortAudio missing
        print(f"Could not open the sound output: {error}", file=sys.stderr)
        return 1

    ended_notice = False
    saved = False
    with KeyReader() as keys:
        player.start()
        try:
            while True:
                char = keys.read()
                key = normalise_key(char) if char else None
                if key == QUIT:
                    print("Quit - nothing saved.")
                    break
                if key:
                    if key == RESTART:
                        player.restart()
                        ended_notice = False
                    message = handle_key(session, key, start_ms + player.now_ms() + shift_ms)
                    if message:
                        print(message)
                    if key in (ENTER, BACKSPACE, RESTART) and not session.done:
                        print(f"Next: {session.next_item.label()}")
                if not session.done and player.heard_end():
                    if session.next_item.kind == "end":
                        print(handle_key(session, ENTER, end_ms))  # the section end closes the last line
                    elif not ended_notice:
                        print("The section ended before all lines were stamped: press r to restart, or q to quit.")
                        ended_notice = True
                if session.done:
                    if out.exists():
                        out.with_suffix(".lrc.bak").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
                    out.write_text(session.to_lrc(), encoding="utf-8")
                    saved = True
                    print()
                    print(f"Saved {lines} lines to {out}")
                    break
                time.sleep(0.005)
        except KeyboardInterrupt:
            print("Quit - nothing saved.")
        finally:
            player.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
