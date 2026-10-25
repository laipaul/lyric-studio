"""LRC reading/writing on the Python side: standard line stamps, enhanced word tags (<mm:ss.xx>),
"* " hook markers and empty pause/end stamps. Same rules as packages/video/src/lrc.ts."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

STAMP = re.compile(r"\[(\d+):(\d{1,2}(?:\.\d{1,3})?)\]")
WORD_TAG = re.compile(r"<(\d+):(\d{1,2}(?:\.\d{1,3})?)>")
HOOK = re.compile(r"^\*\s+")


def format_stamp(ms: int, brackets: str = "[]") -> str:
    total = max(0, round(ms / 10))  # centiseconds
    return f"{brackets[0]}{total // 6000:02d}:{(total % 6000) / 100:05.2f}{brackets[1]}"


def normalize_lyric(text: str) -> str:
    """Case, punctuation, symbols and extra spaces ignored (as normalizeLyric in TypeScript)."""
    text = HOOK.sub("", unicodedata.normalize("NFC", text)).lower()
    text = "".join(" " if unicodedata.category(c)[0] in "PS" else c for c in text)
    return " ".join(text.split())


@dataclass
class Word:
    text: str
    start_ms: int
    end_ms: int
    score: float


@dataclass
class AlignedLine:
    text: str  # without the "* " marker
    is_hook: bool
    words: list[Word] = field(default_factory=list)

    @property
    def start_ms(self) -> int:
        return self.words[0].start_ms

    @property
    def end_ms(self) -> int:
        return self.words[-1].end_ms

    @property
    def confidence(self) -> float:
        return sum(w.score for w in self.words) / len(self.words) if self.words else 0.0


PAUSE_AFTER_MS = 300  # a pause stamp comes this long after the last word of the line before it
END_AFTER_MS = 500  # the end of the last line


def build_lrc(items: list[tuple[str, AlignedLine | None]], duration_ms: int, header: list[str] | None = None) -> str:
    """items: ("line", AlignedLine) or ("pause", None), in lyrics.txt order. Writes enhanced LRC:
    [mm:ss.xx]* <mm:ss.xx>word <mm:ss.xx>word ... <mm:ss.xx>
    The last tag (with no word after it) is where the last word ends: the singing of the line stops
    there, which "pnpm make" needs to cut cleanly between lines."""
    out = list(header or [])
    lines = [line for kind, line in items if kind == "line" and line is not None]
    previous: AlignedLine | None = None
    for index, (kind, line) in enumerate(items):
        if kind == "pause":
            if previous is None:
                continue
            following = next((l for k, l in items[index + 1 :] if k == "line" and l is not None), None)
            at = previous.end_ms + PAUSE_AFTER_MS
            if following is not None:
                at = min(at, following.start_ms - 100)
            out.append(format_stamp(max(at, previous.end_ms)))
            continue
        assert line is not None
        words = " ".join(f"{format_stamp(w.start_ms, '<>')}{w.text}" for w in line.words)
        out.append(f"{format_stamp(line.start_ms)}{'* ' if line.is_hook else ''}{words} {format_stamp(line.end_ms, '<>')}")
        previous = line
    if lines:
        out.append(format_stamp(min(duration_ms, lines[-1].end_ms + END_AFTER_MS)))
    return "\n".join(out) + "\n"


@dataclass
class LrcLine:
    start_ms: int
    text: str  # words only (no stamps, word tags or hook marker)
    is_hook: bool
    words: list[tuple[int, str]]  # (start ms, word) from enhanced tags, if any
    end_ms: int | None = None  # end of the last word (a trailing tag with no word), if written


def _ms(minutes: str, seconds: str) -> int:
    return round((int(minutes) * 60 + float(seconds)) * 1000)


def parse_lrc(content: str) -> list[LrcLine]:
    """Lyric lines (with text) in time order; pause/end stamps and [tag:value] lines are skipped."""
    lines: list[LrcLine] = []
    for raw in content.lstrip("﻿").splitlines():
        stamps = list(STAMP.finditer(raw))
        if not stamps:
            continue
        body = STAMP.sub("", raw).strip()
        is_hook = bool(HOOK.match(body))
        body = HOOK.sub("", body)
        words = [(_ms(m.group(1), m.group(2)), "") for m in WORD_TAG.finditer(body)]
        parts = WORD_TAG.split(body)
        # WORD_TAG.split -> [before, m, s, word, m, s, word, ...]
        end_ms = None
        if words:
            words = [(_ms(parts[i], parts[i + 1]), parts[i + 2].strip()) for i in range(1, len(parts) - 2, 3)]
            if words and not words[-1][1]:
                end_ms = words[-1][0]  # trailing tag: the end of the last word
            words = [w for w in words if w[1]]
        text = " ".join(WORD_TAG.sub(" ", body).split())
        if not text:
            continue
        for s in stamps:
            lines.append(LrcLine(_ms(s.group(1), s.group(2)), text, is_hook, words, end_ms))
    return sorted(lines, key=lambda l: l.start_ms)
