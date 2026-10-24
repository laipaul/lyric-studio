"""--hint <taps.lrc>: rescue low-confidence lines with the hand-tapped times.

For each aligned line below HINT_CONFIDENCE that has a matching tapped line, the prior is the tapped
time corrected by the typical offset between taps and alignment (taps are usually a bit late). The
line is moved to the voice onset on the vocal track nearest to that prior (within SEARCH_MS); if there
is none, to the prior itself. Lines already close to the prior are left alone.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .compare import Comparison
from .lrc import AlignedLine
from .refine import GAP_MS, HOP_S

HINT_CONFIDENCE = 0.7
SEARCH_MS = 1500  # look for a voice onset this far around the prior
KEEP_WITHIN_MS = 150  # already this close to the prior: leave the line alone


def voice_onsets(envelope: np.ndarray, threshold: float) -> list[int]:
    """Times (ms) where the voice starts after a pause of at least GAP_MS (and the very first voice)."""
    voiced = np.nonzero(envelope > threshold)[0]
    if not len(voiced):
        return []
    gap_frames = int(GAP_MS / 1000 / HOP_S)
    onsets = [int(voiced[0])]
    for prev, cur in zip(voiced, voiced[1:]):
        if cur - prev > gap_frames:
            onsets.append(int(cur))
    return [round(f * HOP_S * 1000) for f in onsets]


@dataclass
class HintDecision:
    number: int  # line number (1-based)
    text: str
    confidence: float
    aligned_ms: int
    tapped_ms: int
    prior_ms: int
    target_ms: int  # where the line should start
    source: str  # "voice onset" or "tap (no voice onset nearby)"
    method: str = ""  # filled in when applied: "re-aligned" or "shifted"
    new_ms: int | None = None  # start after applying


def plan_hints(
    lines: list[AlignedLine],
    taps: Comparison,
    onsets_ms: list[int],
    threshold: float = HINT_CONFIDENCE,
) -> list[HintDecision]:
    """Which low-confidence lines to move, and where. `taps` matches aligned lines to tapped lines;
    its typical offset (alignment minus taps) turns a tapped time into a prior."""
    offset = taps.typical_offset_ms
    decisions: list[HintDecision] = []
    for row in taps.rows:
        line = lines[row.number - 1]
        if line.confidence >= threshold:
            continue
        prior = round(row.tapped_ms + offset)
        if abs(line.start_ms - prior) <= KEEP_WITHIN_MS:
            continue
        # Stay between the neighbouring lines.
        low = lines[row.number - 2].start_ms + 1 if row.number > 1 else 0
        high = lines[row.number].start_ms - 1 if row.number < len(lines) else 10**9
        nearby = [o for o in onsets_ms if abs(o - prior) <= SEARCH_MS and low <= o <= high]
        if nearby:
            target, source = min(nearby, key=lambda o: abs(o - prior)), "voice onset"
        else:
            target, source = min(max(prior, low), high), "tap (no voice onset nearby)"
        decisions.append(HintDecision(row.number, line.text, line.confidence, line.start_ms, row.tapped_ms, prior, target, source))
    return decisions


def shift_line(line: AlignedLine, target_ms: int, limit_ms: int | None) -> AlignedLine:
    """Moves a line's words so it starts at target_ms, squeezing them if needed to end before limit_ms."""
    from .lrc import Word

    delta = target_ms - line.start_ms
    words = [Word(w.text, w.start_ms + delta, w.end_ms + delta, w.score) for w in line.words]
    if limit_ms is not None and words[-1].end_ms > limit_ms and limit_ms > target_ms:
        scale = (limit_ms - target_ms) / (words[-1].end_ms - target_ms)
        words = [
            Word(w.text, target_ms + round((w.start_ms - target_ms) * scale), target_ms + round((w.end_ms - target_ms) * scale), w.score)
            for w in words
        ]
    return AlignedLine(text=line.text, is_hook=line.is_hook, words=words)
