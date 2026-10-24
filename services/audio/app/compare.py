"""--compare: aligned line starts vs a hand-tapped reference LRC."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from difflib import SequenceMatcher

from .lrc import AlignedLine, LrcLine, normalize_lyric


@dataclass
class Row:
    number: int  # line number among the aligned lines (1-based)
    text: str
    tapped_ms: int
    aligned_ms: int
    confidence: float

    @property
    def diff_ms(self) -> int:  # positive: the alignment is later than the tap
        return self.aligned_ms - self.tapped_ms


@dataclass
class Comparison:
    rows: list[Row]
    missing_in_reference: list[str]  # aligned lines with no matching tapped line
    missing_in_alignment: list[str]  # tapped lines with no matching aligned line

    @property
    def median_abs_ms(self) -> float:
        return statistics.median(abs(r.diff_ms) for r in self.rows) if self.rows else 0.0

    @property
    def typical_offset_ms(self) -> float:
        """Median signed difference: a constant offset between the taps and the alignment."""
        return statistics.median(r.diff_ms for r in self.rows) if self.rows else 0.0

    @property
    def shift_suggestion_s(self) -> float:
        """The "pnpm lrc:shift <reference>" value that moves the taps onto the alignment (0.05 s steps)."""
        steps = abs(self.typical_offset_ms) / 50
        return math.copysign(math.floor(steps + 0.5) * 0.05, self.typical_offset_ms)  # half away from zero

    def worst(self, n: int = 5) -> list[Row]:
        return sorted(self.rows, key=lambda r: abs(r.diff_ms), reverse=True)[:n]

    def tapped_for(self, number: int) -> int | None:
        return next((r.tapped_ms for r in self.rows if r.number == number), None)


def compare(aligned: list[AlignedLine], reference: list[LrcLine]) -> Comparison:
    """Matches lines by order and words (so an extra or missing line does not shift the rest)."""
    a_keys = [normalize_lyric(l.text) for l in aligned]
    r_keys = [normalize_lyric(l.text) for l in reference]
    rows: list[Row] = []
    matched_a: set[int] = set()
    matched_r: set[int] = set()
    for block in SequenceMatcher(a=a_keys, b=r_keys, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            i, j = block.a + k, block.b + k
            line = aligned[i]
            rows.append(Row(i + 1, line.text, reference[j].start_ms, line.start_ms, line.confidence))
            matched_a.add(i)
            matched_r.add(j)
    return Comparison(
        rows=sorted(rows, key=lambda r: r.number),
        missing_in_reference=[l.text for i, l in enumerate(aligned) if i not in matched_a],
        missing_in_alignment=[l.text for j, l in enumerate(reference) if j not in matched_r],
    )
