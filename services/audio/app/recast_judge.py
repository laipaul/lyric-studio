"""Recast judge (Recast spike, 18 Nov 2026): compares a recast clip with its original, frame by frame, locally.

Three checks, each with a verdict in plain words (prints JSON):
  face         Is the new person the character? Share of sampled frames whose face matches the character's
               pictures (SFace, best of the references), the weakest moment, and frames where the ORIGINAL person's
               face is still visible (a result face closer to the original's face than to the character's).
  environment  Was the scene kept? The person is masked out in both (MediaPipe pose segmentation + the face boxes),
               then the background is compared: SSIM (structure) and an HSV colour histogram (colour). A low score
               means the model repainted the scene.
  motion       Was the movement kept? Body keypoints (MediaPipe pose, normalised to the body's own size) and the
               optical flow between sampled frames (camera and body movement) of the original vs the result.

The thresholds are first guesses for the spike; the report shows the numbers so they can be tuned on real results.
Usage: python -m app.recast_judge --original o.mp4 --result r.mp4 --reference a.png [--reference b.png] [--every 0.5]
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.face import FaceKit, read_image

# Face: SFace's own same-person line, unless the character's calibration gives another.
GREEN_FROM = 0.363
MIN_FACE_SCORE = 0.6
# Environment: background SSIM / colour correlation. SSIM is lenient on smooth, flat areas (sky, plain walls): two
# different smooth pictures can score ~0.5, so the colour check must agree before a scene counts as kept.
SSIM_OK, SSIM_REPAINTED = 0.55, 0.35
HIST_OK, HIST_REPAINTED = 0.85, 0.6
MIN_BACKGROUND = 0.12  # share of the frame that must be background to judge it
# Motion: mean keypoint distance (in shoulder widths) and flow correlation.
POSE_OK, POSE_OFF = 0.35, 0.7
FLOW_OK, FLOW_OFF = 0.6, 0.3  # flow agreement (median over the sampled moments)
FLOW_STEP = 0.1  # seconds between the two pictures whose flow is measured


@dataclass
class Frame:
    t: float
    img: np.ndarray


def sample_times(duration: float, every: float = 0.5, max_frames: int = 40) -> list[float]:
    """Times to look at: every `every` seconds from 0.1 s, at most `max_frames` (spread evenly when longer)."""
    if duration <= 0:
        return []
    times = list(np.arange(min(0.1, duration / 2), max(duration - 0.05, 0.01), every))
    if len(times) > max_frames:
        times = list(np.linspace(times[0], times[-1], max_frames))
    return [round(float(t), 3) for t in times]


def read_frames(path: str | Path, times: list[float], size: tuple[int, int] | None = None) -> list[Frame]:
    import cv2

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open {Path(path).name} as a video.")
    out: list[Frame] = []
    try:
        for t in times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, img = cap.read()
            if not ok:
                continue
            if size and (img.shape[1], img.shape[0]) != size:
                img = cv2.resize(img, size, interpolation=cv2.INTER_AREA)
            out.append(Frame(t, img))
    finally:
        cap.release()
    return out


def video_duration(path: str | Path) -> tuple[float, tuple[int, int]]:
    import cv2

    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        return (n / fps if fps else 0.0), (w, h)
    finally:
        cap.release()


# ---------------------------------------------------------------- pure measures (tested without models)


def masked_ssim(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float | None:
    """SSIM of two grey images (same size), averaged over mask > 0 only. None when the mask is (almost) empty."""
    import cv2

    if mask.sum() < 50:
        return None
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)  # noqa: E731
    mu_a, mu_b = blur(a), blur(b)
    var_a = blur(a * a) - mu_a**2
    var_b = blur(b * b) - mu_b**2
    cov = blur(a * b) - mu_a * mu_b
    ssim_map = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a**2 + mu_b**2 + c1) * (var_a + var_b + c2))
    return float(ssim_map[mask > 0].mean())


def hist_corr(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float | None:
    """Correlation of the HSV colour histograms (hue x saturation) of two BGR images over mask > 0."""
    import cv2

    if mask.sum() < 50:
        return None
    m = (mask > 0).astype(np.uint8)
    hists = []
    for img in (a, b):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h = cv2.calcHist([hsv], [0, 1], m, [30, 32], [0, 180, 0, 256])
        cv2.normalize(h, h, 0, 1, cv2.NORM_MINMAX)
        hists.append(h)
    return float(cv2.compareHist(hists[0], hists[1], cv2.HISTCMP_CORREL))


def normalise_pose(points: list[tuple[float, float, float]] | None, min_vis: float = 0.5) -> dict[int, np.ndarray] | None:
    """Keypoints relative to the mid-shoulders, in shoulder widths (so size and position in the frame do not count)."""
    if not points or len(points) < 13:
        return None
    ls, rs = points[11], points[12]
    if ls[2] < min_vis or rs[2] < min_vis:
        return None
    centre = np.array([(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2])
    width = float(np.hypot(ls[0] - rs[0], ls[1] - rs[1]))
    if width < 1:
        return None
    return {i: (np.array(p[:2]) - centre) / width for i, p in enumerate(points) if p[2] >= min_vis}


def pose_distance(a: dict[int, np.ndarray] | None, b: dict[int, np.ndarray] | None) -> float | None:
    """Mean distance (shoulder widths) of the keypoints both poses see; None with fewer than 4 in common."""
    if not a or not b:
        return None
    common = [i for i in a if i in b]
    if len(common) < 4:
        return None
    return float(np.mean([np.linalg.norm(a[i] - b[i]) for i in common]))


def pearson(x: list[float], y: list[float]) -> float | None:
    if len(x) < 3 or len(x) != len(y):
        return None
    xa, ya = np.array(x), np.array(y)
    if xa.std() < 1e-6 and ya.std() < 1e-6:
        return 1.0  # both still: the same (no) movement
    if xa.std() < 1e-6 or ya.std() < 1e-6:
        return 0.0
    return float(np.corrcoef(xa, ya)[0, 1])


def flow_field(a: np.ndarray, b: np.ndarray, grid: int = 8) -> np.ndarray:
    """Optical flow from picture a to b (taken a moment apart), averaged into grid x grid cells, in frame widths."""
    import cv2

    def small(img: np.ndarray) -> np.ndarray:
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        s = 240 / max(g.shape)
        g = cv2.resize(g, (max(1, round(g.shape[1] * s)), max(1, round(g.shape[0] * s)))) if s < 1 else g
        return cv2.equalizeHist(g)  # colour / brightness changes between the two videos count less

    p, q = small(a), small(b)
    f = cv2.calcOpticalFlowFarneback(p, q, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    h, w = f.shape[:2]
    cells = cv2.resize(f, (grid, grid), interpolation=cv2.INTER_AREA)
    return cells / w


def flow_agreement(fo: np.ndarray, fr: np.ndarray, still: float = 0.002) -> float | None:
    """How alike two flow fields are, from -1 (opposite) to 1 (the same movement): the cosine of the motion vectors
    per cell, weighted by how much moves there, times how alike their sizes are. None when both are still."""
    mo = np.hypot(fo[..., 0], fo[..., 1])
    mr = np.hypot(fr[..., 0], fr[..., 1])
    weight = np.maximum(mo, mr)
    if weight.mean() < still:
        return None
    dot = (fo * fr).sum(axis=-1)
    cos = np.where((mo > 1e-6) & (mr > 1e-6), dot / np.maximum(mo * mr, 1e-12), 0.0)
    size = np.minimum(mo, mr) / np.maximum(weight, 1e-12)
    return float((weight * cos * (0.5 + 0.5 * size)).sum() / weight.sum())


def median(xs: list[float]) -> float | None:
    return float(np.median(xs)) if xs else None


def r3(x: float | None) -> float | None:
    return None if x is None else round(x, 3)


# ---------------------------------------------------------------- verdicts (plain words)


def face_verdict(share: float | None, frames_with_face: int, frames: int, old_face: list[float]) -> tuple[str, str]:
    if not frames_with_face:
        return "problem", "No face found in the result: the character could not be checked (the face may be too small or turned away)."
    level = "ok" if share is not None and share >= 0.8 else "warn" if share is not None and share >= 0.5 else "problem"
    text = f"The character's face in {round((share or 0) * 100)}% of the frames with a face ({frames_with_face} of {frames} frames show one)."
    if old_face:
        level = "problem"
        text += f" The original person's face is still visible at {', '.join(f'{t:.1f} s' for t in old_face[:6])}{' …' if len(old_face) > 6 else ''}."
    return level, text


def environment_verdict(ssim: float | None, hist: float | None, background: float | None) -> tuple[str, str]:
    if ssim is None or hist is None:
        return "info", "The person fills almost the whole frame: too little background to judge the scene."
    nums = f"(structure {ssim:.2f}, colour {hist:.2f})"
    if ssim < SSIM_REPAINTED or hist < HIST_REPAINTED:
        return "problem", f"Repainted scene: the background is no longer the original {nums}."
    if ssim < SSIM_OK or hist < HIST_OK:
        return "warn", f"The scene changed somewhat around the person {nums}."
    return "ok", f"Scene kept: the background matches the original {nums}."


def motion_verdict(pose: float | None, flow: float | None, pose_frames: int) -> tuple[str, str]:
    parts = []
    level = "ok"
    if pose is not None:
        if pose > POSE_OFF:
            level = "problem"
            parts.append(f"the body moves differently from the original (pose off by {pose:.2f} shoulder widths over {pose_frames} frames)")
        elif pose > POSE_OK:
            level = "warn"
            parts.append(f"the body's pose drifts a little ({pose:.2f} shoulder widths)")
        else:
            parts.append(f"the body follows the original ({pose:.2f} shoulder widths apart)")
    if flow is not None:
        if flow < FLOW_OFF:
            level = "problem"
            parts.append(f"the movement over time does not follow the original (movement agreement {flow:.2f})")
        elif flow < FLOW_OK:
            level = "warn" if level == "ok" else level
            parts.append(f"the movement over time follows only partly (movement agreement {flow:.2f})")
        else:
            parts.append(f"the movement over time follows the original (movement agreement {flow:.2f})")
    if not parts:
        return "info", "Too short, or no body seen, to judge the movement."
    return level, ("Motion kept: " if level == "ok" else "") + "; ".join(parts) + "."


# ---------------------------------------------------------------- the judge


class Judge:
    def __init__(self, kit: FaceKit | None = None):
        self.kit = kit or FaceKit()
        self._seg = None

    def close(self) -> None:
        if self._seg is not None:
            self._seg.close()
            self._seg = None
        self.kit.close()

    def _segmenter(self):
        from mediapipe.tasks.python import BaseOptions, vision

        if self._seg is None:
            opts = vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_buffer=self.kit.paths["pose"].read_bytes()),
                num_poses=3,
                output_segmentation_masks=True,
            )
            self._seg = vision.PoseLandmarker.create_from_options(opts)
        return self._seg

    def person(self, img: np.ndarray) -> tuple[np.ndarray, list[tuple[float, float, float]] | None]:
        """A mask of the people (1 = person) and the main person's keypoints."""
        import cv2

        h, w = img.shape[:2]
        mask = np.zeros((h, w), np.uint8)
        res = self._segmenter().detect(self.kit._mp_image(img))
        for m in res.segmentation_masks or []:
            mask |= (m.numpy_view().reshape(h, w) > 0.5).astype(np.uint8)
        for f in self.kit.detect(img, min_score=MIN_FACE_SCORE):  # the head and hair, where the pose model misses them
            x0, y0 = int(max(0, f.x - f.w * 0.6)), int(max(0, f.y - f.h * 0.8))
            x1, y1 = int(min(w, f.x + f.w * 1.6)), int(min(h, f.y + f.h * 2.2))
            mask[y0:y1, x0:x1] = 1
        mask = cv2.dilate(mask, np.ones((max(3, w // 40), max(3, w // 40)), np.uint8))
        pts = None
        if res.pose_landmarks:
            pts = [(p.x * w, p.y * h, float(p.visibility if p.visibility is not None else 0.0)) for p in res.pose_landmarks[0]]
        return mask, pts

    def references(self, refs: list[str]) -> list[np.ndarray]:
        prints = []
        for r in refs:
            img = read_image(r)
            faces = self.kit.detect(img)
            if faces:
                prints.append(self.kit.embed(img, faces[0]))
        if not prints:
            raise ValueError("No face found in the character's pictures.")
        return prints

    def judge(self, original: str, result: str, refs: list[str], every: float = 0.5, green: float = GREEN_FROM) -> dict:
        import cv2

        dur_o, size_o = video_duration(original)
        dur_r, _ = video_duration(result)
        times = sample_times(min(dur_o, dur_r) if dur_r else dur_o, every)
        fo = read_frames(original, times)
        fr = {f.t: f for f in read_frames(result, times, size_o)}
        pairs = [(f, fr[f.t]) for f in fo if f.t in fr]
        prints = self.references(refs)

        face_rows, old_face, ssims, hists, bgs, poses = [], [], [], [], [], []
        for o, r in pairs:
            # Face: every face in the result vs the character, and vs the original's main face at that moment.
            orig_faces = self.kit.detect(o.img, min_score=MIN_FACE_SCORE)
            orig_print = self.kit.embed(o.img, orig_faces[0]) if orig_faces else None
            best, old = None, False
            for f in self.kit.detect(r.img, min_score=MIN_FACE_SCORE):
                e = self.kit.embed(r.img, f)
                s = max(self.kit.similarity(p, e) for p in prints)
                best = s if best is None or s > best else best
                if orig_print is not None:
                    so = self.kit.similarity(orig_print, e)
                    if so >= green and so > s + 0.05:
                        old = True
            face_rows.append({"t": o.t, "score": r3(best)})
            if old:
                old_face.append(o.t)
            # Environment and motion: the people masked out in both.
            mo, po = self.person(o.img)
            mr, pr = self.person(r.img)
            bg = (1 - np.maximum(mo, mr)).astype(np.uint8)
            share = float(bg.mean())
            bgs.append(share)
            if share >= MIN_BACKGROUND:
                ga, gb = cv2.cvtColor(o.img, cv2.COLOR_BGR2GRAY), cv2.cvtColor(r.img, cv2.COLOR_BGR2GRAY)
                s = masked_ssim(ga, gb, bg)
                hc = hist_corr(o.img, r.img, bg)
                if s is not None:
                    ssims.append(s)
                if hc is not None:
                    hists.append(hc)
            d = pose_distance(normalise_pose(po), normalise_pose(pr))
            if d is not None:
                poses.append(d)

        with_face = [x for x in face_rows if x["score"] is not None]
        share = (sum(1 for x in with_face if x["score"] >= green) / len(with_face)) if with_face else None
        weakest = min(with_face, key=lambda x: x["score"]) if with_face else None
        fl, ft = face_verdict(share, len(with_face), len(face_rows), old_face)

        ssim, hist = median(ssims), median(hists)
        el, et = environment_verdict(ssim, hist, median(bgs))

        # Movement: at each sampled moment, the flow over the next 0.1 s in both, compared cell by cell.
        later = [round(t + FLOW_STEP, 3) for t in times]
        lo = {round(f.t - FLOW_STEP, 3): f for f in read_frames(original, later)}
        lr = {round(f.t - FLOW_STEP, 3): f for f in read_frames(result, later, size_o)}
        agreements, drifts = [], []
        for o, r in pairs:
            if o.t in lo and o.t in lr:
                fo, fr2 = flow_field(o.img, lo[o.t].img), flow_field(r.img, lr[o.t].img)
                a = flow_agreement(fo, fr2)
                if a is not None:
                    agreements.append(a)
                drifts.append(float(np.hypot(*(fo.mean(axis=(0, 1)) - fr2.mean(axis=(0, 1))))))
        flow = median(agreements) if agreements else (1.0 if drifts else None)  # both still throughout: the same
        drift = median(drifts)
        pose = median(poses)
        ml, mt = motion_verdict(pose, flow, len(poses))

        return {
            "frames": len(pairs),
            "every_s": every,
            "face": {
                "level": fl,
                "text": ft,
                "green_from": green,
                "share_matching": r3(share),
                "median": r3(median([x["score"] for x in with_face])),
                "weakest": weakest,
                "old_face_at": old_face,
                "per_frame": face_rows,
            },
            "environment": {"level": el, "text": et, "ssim": r3(ssim), "colour": r3(hist), "background_share": r3(median(bgs))},
            "motion": {"level": ml, "text": mt, "pose_distance": r3(pose), "pose_frames": len(poses), "flow_correlation": r3(flow), "camera_drift": r3(drift)},
        }


def main(argv: list[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="recast_judge", description="Compares a recast clip with its original (prints JSON).")
    ap.add_argument("--original", required=True)
    ap.add_argument("--result", required=True)
    ap.add_argument("--reference", action="append", required=True)
    ap.add_argument("--every", type=float, default=0.5)
    ap.add_argument("--green", type=float, default=GREEN_FROM)
    a = ap.parse_args(argv)
    j = Judge()
    try:
        out = j.judge(a.original, a.result, a.reference, a.every, a.green)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 2
    finally:
        j.close()
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.exit(main(sys.argv[1:]))
