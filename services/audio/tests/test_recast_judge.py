"""Recast judge (app/recast_judge.py): the measures and verdicts on made-up pictures, and one whole run on two small
made-up videos (no people: the checks must say so plainly instead of guessing). The whole run needs the face models
(pnpm audio:setup --face)."""
from pathlib import Path

import numpy as np
import pytest

from app import recast_judge as rj

MODELS = Path(__file__).resolve().parent.parent / "models" / "face"


def scene(seed=1, h=120, w=90):
    rng = np.random.default_rng(seed)
    base = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    import cv2

    return cv2.GaussianBlur(base, (7, 7), 2)


def test_sample_times_every_half_second_capped():
    assert rj.sample_times(2.0) == [0.1, 0.6, 1.1, 1.6]
    assert len(rj.sample_times(60.0, 0.5, 40)) == 40
    assert rj.sample_times(0) == []


def test_masked_ssim_and_colour_same_vs_repainted():
    import cv2

    a = scene(1)
    mask = np.ones(a.shape[:2], np.uint8)
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    assert rj.masked_ssim(ga, ga, mask) == pytest.approx(1.0)
    assert rj.hist_corr(a, a, mask) == pytest.approx(1.0)
    # Another scene: stripes in other colours (smooth, low-contrast pictures score higher; the colour check covers that).
    b = np.zeros_like(a)
    b[::8] = (40, 200, 60)
    b[4::8] = (230, 30, 200)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    assert rj.masked_ssim(ga, gb, mask) < 0.35
    assert rj.hist_corr(a, b, mask) < 0.6
    # Only the masked part counts: change the masked-out half, the rest stays identical.
    c = a.copy()
    c[:, : a.shape[1] // 2] = 0
    half = mask.copy()
    half[:, : a.shape[1] // 2 + 8] = 0
    assert rj.masked_ssim(ga, cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), half) > 0.95
    assert rj.masked_ssim(ga, ga, np.zeros_like(mask)) is None


def test_pose_normalised_to_shoulders():
    pts = [(0.0, 0.0, 0.0)] * 33
    pts = list(pts)
    pts[11], pts[12] = (100.0, 100.0, 1.0), (200.0, 100.0, 1.0)
    pts[13], pts[14], pts[15], pts[16] = (90.0, 180.0, 1.0), (210.0, 180.0, 1.0), (80.0, 250.0, 1.0), (220.0, 250.0, 1.0)
    bigger = [(x * 2 + 50, y * 2 + 30, v) for x, y, v in pts]  # the same pose, larger and elsewhere in the frame
    assert rj.pose_distance(rj.normalise_pose(pts), rj.normalise_pose(bigger)) == pytest.approx(0.0, abs=1e-9)
    moved = list(pts)
    moved[15] = (80.0, 120.0, 1.0)  # an arm raised
    assert rj.pose_distance(rj.normalise_pose(pts), rj.normalise_pose(moved)) > 0.2
    assert rj.normalise_pose(None) is None


def test_flow_agreement_same_opposite_still():
    a = np.zeros((8, 8, 2))
    a[..., 0] = 0.01  # everything moves right
    assert rj.flow_agreement(a, a) == pytest.approx(1.0)
    assert rj.flow_agreement(a, -a) == pytest.approx(-1.0)
    b = a.copy()
    b[..., 0] = 0.005  # the same direction, half as far
    assert 0.6 < rj.flow_agreement(a, b) < 1.0
    assert rj.flow_agreement(np.zeros((8, 8, 2)), np.zeros((8, 8, 2))) is None  # both still


def test_pearson_and_verdicts():
    assert rj.pearson([1, 2, 3, 4], [2, 4, 6, 8]) == pytest.approx(1.0)
    assert rj.pearson([0, 0, 0], [0, 0, 0]) == 1.0
    assert rj.pearson([1, 2], [1, 2]) is None
    assert rj.face_verdict(0.9, 10, 10, [])[0] == "ok"
    lvl, text = rj.face_verdict(0.9, 10, 10, [1.1, 1.6])
    assert lvl == "problem" and "still visible at 1.1 s, 1.6 s" in text
    assert rj.face_verdict(None, 0, 8, [])[1].startswith("No face found")
    assert rj.environment_verdict(0.2, 0.9, 0.5)[1].startswith("Repainted scene")
    assert rj.environment_verdict(0.8, 0.95, 0.5)[0] == "ok"
    assert "too little background" in rj.environment_verdict(None, None, 0.05)[1]
    assert rj.motion_verdict(0.1, 0.9, 6)[1].startswith("Motion kept")
    assert rj.motion_verdict(0.9, 0.9, 6)[0] == "problem"
    assert rj.motion_verdict(None, None, 0)[0] == "info"


@pytest.mark.skipif(not (MODELS / "pose_landmarker_full.task").exists(), reason="face models not installed (pnpm audio:setup --face)")
def test_whole_run_on_videos_without_people(tmp_path):
    import cv2

    def video(path, shift):
        out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (90, 120))
        base = scene(3)
        for i in range(20):
            out.write(np.roll(base, i * shift, axis=1))
        out.release()

    o, r = tmp_path / "o.mp4", tmp_path / "r.mp4"
    video(o, 2)
    video(r, 2)
    ref = Path(__file__).resolve().parent.parent / "tests"  # a picture with a face is needed: make one from a model test image if present
    j = rj.Judge()
    try:
        with pytest.raises(ValueError, match="No face found in the character"):
            cv2.imwrite(str(tmp_path / "ref.png"), scene(2))
            j.judge(str(o), str(r), [str(tmp_path / "ref.png")])
        # Environment and motion without a face reference: the measures themselves.
        fo = rj.read_frames(o, rj.sample_times(2.0))
        fr = rj.read_frames(r, rj.sample_times(2.0))
        assert len(fo) == len(fr) == 4
        f1 = rj.flow_field(fo[0].img, fo[1].img)
        assert rj.flow_agreement(f1, f1) == pytest.approx(1.0)
        assert rj.flow_agreement(f1, -f1) < -0.9
        mask, pts = j.person(fo[0].img)
        assert mask.shape == fo[0].img.shape[:2] and pts is None
    finally:
        j.close()
