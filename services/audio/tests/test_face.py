"""Face checks for Characters (app/face.py): the verdict rules, thresholds, body visibility and lighting.

The rules are pure functions on measurements, so they run everywhere. The model tests at the bottom run only when the
face packages are installed (pnpm audio:setup --face) and the models are in services/audio/models/face.
"""
import numpy as np
import pytest

from app import face


def measures(**over):
    m = {
        "width": 1024, "height": 1536, "faces": 1, "face_score": 0.95, "face_px": 600, "second_face_ratio": 0.0,
        "sharpness": 150.0,
        "lighting": {"exposure": 130.0, "clipped_pct": 0.0, "crushed_pct": 0.0, "balance": 1.1},
        "pose": {"yaw": 3.0, "pitch": -2.0, "roll": 0.0},
        "expression": {"mouth_open": 0.02, "eyes_closed": False, "eye_blink": [0.1, 0.1]},
        "visible": {"eyes": True, "nose": True, "mouth": True},
        "hand_over_mouth": False, "body": "head and shoulders",
    }
    m.update(over)
    return m


def det(x, y, w, h, score):
    r = np.zeros(15, dtype=np.float32)
    r[:4] = (x, y, w, h)
    r[14] = score
    return r


def test_merge_keeps_the_best_of_overlapping_boxes():
    out = face.merge_detections([det(100, 100, 200, 200, 0.7), det(105, 98, 205, 210, 0.92)])
    assert len(out) == 1 and abs(float(out[0][14]) - 0.92) < 1e-6


def test_merge_keeps_separate_faces_and_handles_empty():
    out = face.merge_detections([det(0, 0, 100, 100, 0.9), det(500, 0, 100, 100, 0.8)])
    assert len(out) == 2
    assert face.merge_detections([]) == []


def run(**over):
    reasons, fixes = face.judge_reference(measures(**over))
    return face.verdict(reasons), reasons, fixes


def text(reasons, check):
    return " ".join(r["text"] for r in reasons if r["check"] == check)


def test_a_good_portrait_is_ready_with_plain_reasons():
    v, reasons, fixes = run()
    assert v == "Ready"
    assert fixes == []
    assert "One face" in text(reasons, "faces")
    assert "600 px" in text(reasons, "size")
    assert "veil" in text(reasons, "landmarks")  # always says what it cannot see


def test_face_size_target_512_and_minimum_128():
    assert run(face_px=511)[0] == "Usable with fix" and "upscale" in run(face_px=511)[2]
    assert run(face_px=127)[0] == "Not suitable"
    assert "at least 128 px" in text(run(face_px=90)[1], "size")


def test_no_face_or_several_faces():
    v, reasons, _ = run(faces=0)
    assert v == "Not suitable" and "No face found" in reasons[0]["text"]
    v, reasons, fixes = run(faces=3, second_face_ratio=0.2)
    assert v == "Usable with fix" and fixes[0] == "crop"
    assert run(faces=2, second_face_ratio=0.9)[0] == "Not suitable"


def test_blur_head_pose_and_hidden_mouth():
    assert run(sharpness=10)[0] == "Not suitable"
    assert run(sharpness=50)[0] == "Usable with fix"
    assert run(pose={"yaw": 75.0, "pitch": 0.0, "roll": 0.0})[0] == "Not suitable"
    v, reasons, fixes = run(pose={"yaw": 35.0, "pitch": 0.0, "roll": 0.0})
    assert v == "Usable with fix" and "second_image" in fixes and "+35°" in text(reasons, "pose")
    v, reasons, fixes = run(hand_over_mouth=True)
    assert v == "Usable with fix" and "lip sync" in text(reasons, "landmarks") and "second_image" in fixes
    assert "hidden" in text(run(visible={"eyes": True, "nose": True, "mouth": False})[1], "landmarks")


def test_expression_lighting_body():
    v, reasons, _ = run(expression={"mouth_open": 0.6, "eyes_closed": False, "eye_blink": [0, 0]})
    assert v == "Usable with fix" and "mouth open" in text(reasons, "expression")
    assert run(expression={"mouth_open": 0.0, "eyes_closed": True, "eye_blink": [0.9, 0.9]})[0] == "Usable with fix"
    assert run(lighting={"exposure": 40.0, "clipped_pct": 0, "crushed_pct": 30, "balance": 1})[0] == "Usable with fix"
    _, reasons, _ = run(lighting={"exposure": 120.0, "clipped_pct": 0, "crushed_pct": 0, "balance": 2.5})
    assert "one side" in text(reasons, "lighting")
    assert "invented" in text(run(body="head and shoulders")[1], "body")
    assert "invented" not in text(run(body="full body")[1], "body")


def test_no_landmark_model_result_is_said_not_guessed():
    v, reasons, _ = run(pose=None, expression=None)
    assert v == "Ready"
    assert "not possible" in text(reasons, "pose")


def test_thresholds_from_the_users_pictures():
    t = face.thresholds([0.12, 0.21, 0.05], [0.9, 0.8])
    assert t["red_below"] == 0.24 and t["green_from"] == 0.363 and t["others_used"] == 3
    t = face.thresholds([0.30, 0.10], [0.9])
    assert t["green_from"] == 0.4 and t["red_below"] == 0.33
    # A clip at or above SFace's own same-person line is probably her: left out of "other women".
    t = face.thresholds([0.62, 0.15], [0.9])
    assert t["probably_same"] == 1 and t["top_other"] == 0.15
    assert "defaults" in face.thresholds([], [0.9])["note"]


def test_body_visibility():
    pts = [(0.0, 0.0, 0.0)] * 33

    def with_(*ids):
        p = list(pts)
        for i in ids:
            p[i] = (100.0, 100.0, 0.9)
        return p

    size = (500, 500)
    assert face.body_visibility(None, size) == "head only"
    assert face.body_visibility(with_(11, 12), size) == "head and shoulders"
    assert face.body_visibility(with_(11, 23), size) == "upper body"
    assert face.body_visibility(with_(23, 25), size) == "down to the knees"
    assert face.body_visibility(with_(23, 25, 27), size) == "full body"


def test_lighting_balance_and_exposure():
    g = np.zeros((100, 100), np.uint8)
    g[:, :50] = 200
    g[:, 50:] = 50
    li = face.lighting(g, 50)
    assert li["balance"] == 4.0
    assert li["exposure"] == 125.0


def test_scene_rules():
    r = face.judge_scene({"width": 600, "height": 900, "sharpness": 100, "exposure": 120, "faces": 0})
    assert face.verdict(r) == "Usable with fix"
    r = face.judge_scene({"width": 1920, "height": 1080, "sharpness": 100, "exposure": 120, "faces": 2})
    assert face.verdict(r) == "Ready" and any("2 face" in x["text"] for x in r)


# ---- with the real models (only when installed) ----

def has_cv2():
    try:
        import cv2  # noqa: F401
    except ImportError:
        return False
    return True


needs_cv2 = pytest.mark.skipif(not has_cv2(), reason="face packages not installed (pnpm audio:setup --face)")


def models_present():
    return all((face.MODELS_DIR / name).exists() for _, _, name in face.MODELS.values())


@needs_cv2
def test_sharpness_drops_with_blur():
    import cv2

    rng = np.random.default_rng(1)
    g = (rng.random((256, 256)) * 255).astype(np.uint8)
    assert face.sharpness(cv2.GaussianBlur(g, (0, 0), 3)) < face.sharpness(g) / 5


@needs_cv2
@pytest.mark.skipif(not models_present(), reason="face models not downloaded (pnpm face models)")
def test_a_picture_without_a_face_is_not_suitable(tmp_path):
    p = tmp_path / "plain.png"
    face.write_image(p, np.full((600, 400, 3), 128, np.uint8))
    kit = face.FaceKit()
    try:
        r = face.check_reference(kit, str(p))
    finally:
        kit.close()
    assert r["verdict"] == "Not suitable" and r["measures"]["faces"] == 0
