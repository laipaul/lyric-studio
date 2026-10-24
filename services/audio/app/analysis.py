"""Beat analysis with librosa: BPM, duration, beats with strength, and 4/4 downbeat estimation.

librosa has no downbeat tracker. Assuming 4/4, every 4th beat is a downbeat; the open question
is which of the 4 possible phases. We measure low-frequency (kick/bass, < 150 Hz) onset strength
at every beat and pick the phase whose beats have the strongest low-end hits on average.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np

# Bump when the method changes, so cached results are recomputed.
ANALYZER_VERSION = 1

SR = 22050
HOP = 256  # ~11.6 ms per frame
N_FFT = 2048  # for tempo tracking and the low-frequency (downbeat) band
N_FFT_TIMING = 512  # short window: sharper onset timing for placing each beat
SNAP_FRACTION = 0.15  # a beat may move up to 15% of a beat period to sit on the actual hit
MANUAL_BPM_TOLERANCE = 0.03  # a manual BPM is refined by at most 3%
LOW_FREQ_MAX_HZ = 150.0
BEATS_PER_BAR = 4
MIN_BPM, MAX_BPM = 30.0, 300.0


def _fit_bpm(beat_times: np.ndarray) -> float | None:
    """Precise BPM from the beat grid: a straight-line fit of beat time against beat number.
    Much finer than librosa's tempo estimate (which is rounded to whole frames), and robust to a
    few missed beats."""
    if len(beat_times) < 4:
        return None
    period = float(np.median(np.diff(beat_times)))
    if period <= 0:
        return None
    # Number the beats gap by gap (a gap of ~2 periods means one missed beat). Dividing the total
    # elapsed time by one period instead would let a tiny period error add up on long songs.
    gaps = np.maximum(1, np.round(np.diff(beat_times) / period))
    index = np.concatenate([[0.0], np.cumsum(gaps)])
    slope = np.polyfit(index, beat_times, 1)[0]
    return 60.0 / float(slope) if slope > 0 else None


def _snap_to_onsets(envelope: np.ndarray, frames: np.ndarray, bpm: float) -> np.ndarray:
    """Moves each tracked beat onto the strongest onset nearby and returns times in seconds,
    with sub-frame precision (parabolic interpolation around the peak)."""
    period_frames = 60.0 * SR / HOP / bpm
    radius = max(2, int(period_frames * SNAP_FRACTION))
    times = np.empty(len(frames))
    for i, f in enumerate(frames):
        lo, hi = max(0, f - radius), min(len(envelope), f + radius + 1)
        k = lo + int(np.argmax(envelope[lo:hi]))
        offset = 0.0
        if 0 < k < len(envelope) - 1:
            a, b, c = envelope[k - 1], envelope[k], envelope[k + 1]
            denom = a - 2 * b + c
            if denom != 0:
                offset = float(np.clip(0.5 * (a - c) / denom, -0.5, 0.5))
        times[i] = (k + offset) * HOP / SR
    return times


def _track(onset_env: np.ndarray, timing_env: np.ndarray, bpm: float | None) -> tuple[np.ndarray, float]:
    """One beat-tracking pass. Returns (beat times in seconds, precise BPM)."""
    kwargs = {"bpm": bpm} if bpm is not None else {}
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, hop_length=HOP, **kwargs)
    tracked = float(np.atleast_1d(tempo)[0]) if bpm is None else bpm
    times = _snap_to_onsets(timing_env, np.asarray(frames, dtype=int), tracked)
    # Two beats must never land on the same hit: drop any beat closer than 1/4 period to the previous.
    if len(times):
        min_gap = 60.0 / tracked / 4
        keep = [0]
        for i in range(1, len(times)):
            if times[i] - times[keep[-1]] >= min_gap:
                keep.append(i)
        times = times[keep]
    return times, _fit_bpm(times) or tracked


def _low_frequency_onsets(y: np.ndarray) -> np.ndarray:
    spectrum = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)
    low = librosa.power_to_db(spectrum[freqs <= LOW_FREQ_MAX_HZ], ref=np.max)
    return librosa.onset.onset_strength(S=low, sr=SR, hop_length=HOP)


def _peak_near(envelope: np.ndarray, frames: np.ndarray, radius: int = 2) -> np.ndarray:
    """Largest envelope value within +-radius frames of each beat (beats can sit a frame early/late)."""
    out = np.empty(len(frames))
    for i, f in enumerate(frames):
        lo, hi = max(0, f - radius), min(len(envelope), f + radius + 1)
        out[i] = envelope[lo:hi].max() if hi > lo else 0.0
    return out


def estimate_downbeat_phase(low_strength: np.ndarray | list[float]) -> tuple[int, float]:
    """Returns (phase, confidence). Beats phase, phase+4, phase+8, ... are downbeats.
    Confidence 0..1: how much the best phase stands out from the second best."""
    low_strength = np.asarray(low_strength, dtype=float)
    if len(low_strength) < 2 * BEATS_PER_BAR:
        return 0, 0.0
    scores = np.array([low_strength[p::BEATS_PER_BAR].mean() for p in range(BEATS_PER_BAR)])
    order = np.argsort(scores)[::-1]
    best, second = scores[order[0]], scores[order[1]]
    confidence = 0.0 if best <= 0 else float(np.clip((best - second) / best, 0.0, 1.0))
    return int(order[0]), confidence


def _detect(onset_env: np.ndarray, timing_env: np.ndarray) -> tuple[np.ndarray, float]:
    """Automatic tempo and beats. Pass 1 finds the beats and measures the exact tempo; pass 2
    re-tracks at that exact tempo, so beats do not drift on long songs."""
    _, first_bpm = _track(onset_env, timing_env, None)
    return _track(onset_env, timing_env, first_bpm)


def _near(value: float, target: float) -> bool:
    return abs(value - target) <= target * MANUAL_BPM_TOLERANCE


def _apply_manual_bpm(
    bpm: float,
    times: np.ndarray,
    detected_bpm: float,
    onset_env: np.ndarray,
    timing_env: np.ndarray,
    low_env: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Beats for a BPM chosen by the user.

    Half or double of the detected tempo is derived from the detected beats (keeping the stronger
    half of the beats, or adding a beat between each pair), which is more reliable than tracking
    from scratch. Any other BPM re-runs beat tracking around that tempo."""
    if _near(bpm, detected_bpm):
        result = times, detected_bpm
    elif _near(bpm, detected_bpm / 2) and len(times) >= 4:
        frames = np.round(times * SR / HOP).astype(int)
        weight = _normalised(_peak_near(onset_env, frames)) + _normalised(_peak_near(low_env, frames))
        phase = 0 if weight[0::2].mean() >= weight[1::2].mean() else 1
        halved = times[phase::2]
        result = halved, _fit_bpm(halved) or bpm
    elif _near(bpm, detected_bpm * 2) and len(times) >= 2:
        middles = (times[:-1] + times[1:]) / 2
        snapped = _snap_to_onsets(timing_env, np.round(middles * SR / HOP).astype(int), bpm)
        doubled = np.sort(np.concatenate([times, snapped]))
        result = doubled, _fit_bpm(doubled) or bpm
    else:
        _, first_bpm = _track(onset_env, timing_env, bpm)
        if not _near(first_bpm, bpm):
            first_bpm = bpm
        result = _track(onset_env, timing_env, first_bpm)

    beat_times, final_bpm = result
    # A manual BPM is only fine-tuned (by at most 3%), never replaced.
    return beat_times, final_bpm if _near(final_bpm, bpm) else bpm


def _normalised(values: np.ndarray) -> np.ndarray:
    top = values.max() if len(values) else 0.0
    return values / top if top > 0 else values


def analyze_file(path: Path, bpm: float | None = None) -> dict[str, Any]:
    """Analyses an audio file. With `bpm`, beat tracking is forced around that tempo (manual override)."""
    if bpm is not None and not (MIN_BPM <= bpm <= MAX_BPM):
        raise ValueError(f"bpm must be between {MIN_BPM:g} and {MAX_BPM:g}")

    y, _ = librosa.load(str(path), sr=SR, mono=True)
    duration_ms = int(round(len(y) / SR * 1000))
    if len(y) < SR:  # under 1 second: nothing useful to track
        raise ValueError("audio is too short to analyse (under 1 second)")

    # The mean over frequency bands keeps the kick drum visible (a median would ignore it).
    onset_env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, n_fft=N_FFT)
    timing_env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, n_fft=N_FFT_TIMING, aggregate=np.median)
    low_env = _low_frequency_onsets(y)

    beat_times, final_bpm = _detect(onset_env, timing_env)
    if bpm is not None:
        beat_times, final_bpm = _apply_manual_bpm(bpm, beat_times, final_bpm, onset_env, timing_env, low_env)
    beat_frames = np.round(beat_times * SR / HOP).astype(int)

    # Beat strength 0..1 from the overall onset envelope.
    strength = _normalised(_peak_near(onset_env, beat_frames))

    phase, confidence = estimate_downbeat_phase(_peak_near(low_env, beat_frames))

    beats = [
        {
            "time_ms": int(round(t * 1000)),
            "strength": round(float(s), 3),
            "is_downbeat": (i - phase) % BEATS_PER_BAR == 0,
        }
        for i, (t, s) in enumerate(zip(beat_times, strength))
    ]

    return {
        "bpm": round(float(final_bpm), 2),
        "bpm_source": "manual" if bpm is not None else "detected",
        "bpm_alternatives": {"half": round(float(final_bpm) / 2, 2), "double": round(float(final_bpm) * 2, 2)},
        "duration_ms": duration_ms,
        "downbeat_confidence": round(confidence, 3),
        "beats": beats,
        "analyzer_version": ANALYZER_VERSION,
    }
