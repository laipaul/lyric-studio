"""Face checks for Characters (C1 spike onward): local, CPU, free.

Models (each file's own licence, checked 17 Nov 2026):
  YuNet face detector (opencv_zoo, MIT)            finds faces, 5 landmarks, a confidence
  SFace face recognition (opencv_zoo, Apache 2.0)  128-number "face print"; cosine similarity = same person?
  MediaPipe Face Landmarker (Apache 2.0)           478 landmarks, head pose, blendshapes (mouth / eye openness)
  MediaPipe Pose Landmarker (Apache 2.0)           33 body keypoints (how much of the body is visible)
They are downloaded once into services/audio/models/face/ and checked against pinned SHA-256 sums.

Pictures and videos are only read. Every function returns plain dicts (the CLI prints them as JSON).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")  # no OpenCV backend warnings in the JSON tools' output
os.environ.setdefault("GLOG_minloglevel", "2")

MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "face"

MODELS = {
    "yunet": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "face_detection_yunet_2023mar.onnx",
    ),
    "sface": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "face_recognition_sface_2021dec.onnx",
    ),
    "landmarker": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
        "face_landmarker.task",
    ),
    "pose": (
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
        "pose_landmarker_full.task",
    ),
}

# SFace's own "same person" cosine threshold (opencv_zoo sface.py). Calibration on the user's pictures replaces it.
SFACE_SAME = 0.363
MIN_FACE_SCORE = 0.8  # YuNet confidence for "a face"
TARGET_FACE_PX = 512  # face height for a Ready reference
MIN_FACE_PX = 128  # below this a reference is not usable even with an upscale
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _log(msg: str) -> None:
    print(f"[face] {msg}", file=sys.stderr, flush=True)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_models(models_dir: Path = MODELS_DIR) -> dict[str, Path]:
    """Downloads the model files once (about 52 MB) and checks their SHA-256."""
    models_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for key, (url, sha, name) in MODELS.items():
        path = models_dir / name
        if not path.exists() or _sha256(path) != sha:
            _log(f"downloading {name} (first time only)")
            tmp = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(url, tmp)
            got = _sha256(tmp)
            if got != sha:
                tmp.unlink(missing_ok=True)
                raise RuntimeError(f"{name}: the download does not match its checksum (got {got[:12]}…): not used")
            os.replace(tmp, path)
        out[key] = path
    return out


def read_image(path: str | Path) -> np.ndarray:
    """BGR image; works with any Windows path (accents, spaces)."""
    import cv2

    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"cannot read {path} as a picture")
    return img


def write_image(path: str | Path, img: np.ndarray, quality: int = 92) -> None:
    import cv2

    ext = Path(path).suffix.lower() or ".jpg"
    ok, buf = cv2.imencode(ext, img, [cv2.IMWRITE_JPEG_QUALITY, quality] if ext in (".jpg", ".jpeg") else [])
    if not ok:
        raise ValueError(f"cannot write {path}")
    buf.tofile(str(path))


@dataclass
class Face:
    x: float
    y: float
    w: float
    h: float
    score: float
    row: np.ndarray  # YuNet's 15 numbers (box, 5 landmarks, score), in the image's own pixels

    @property
    def area(self) -> float:
        return self.w * self.h

    def landmarks(self) -> dict[str, tuple[float, float]]:
        r = self.row
        return {
            "right_eye": (r[4], r[5]),
            "left_eye": (r[6], r[7]),
            "nose": (r[8], r[9]),
            "mouth_right": (r[10], r[11]),
            "mouth_left": (r[12], r[13]),
        }


def merge_detections(rows: list[np.ndarray], iou: float = 0.4) -> list[np.ndarray]:
    """The same face found at several scales: of overlapping boxes (IoU >= iou) keep the highest score."""
    kept: list[np.ndarray] = []
    for r in sorted(rows, key=lambda r: float(r[14]), reverse=True):
        x1, y1, x2, y2 = float(r[0]), float(r[1]), float(r[0] + r[2]), float(r[1] + r[3])
        dup = False
        for k in kept:
            kx1, ky1, kx2, ky2 = float(k[0]), float(k[1]), float(k[0] + k[2]), float(k[1] + k[3])
            inter = max(0.0, min(x2, kx2) - max(x1, kx1)) * max(0.0, min(y2, ky2) - max(y1, ky1))
            union = (x2 - x1) * (y2 - y1) + (kx2 - kx1) * (ky2 - ky1) - inter
            if union > 0 and inter / union >= iou:
                dup = True
                break
        if not dup:
            kept.append(r)
    return kept


class FaceKit:
    """Loads each model on first use."""

    def __init__(self, models_dir: Path = MODELS_DIR):
        self.paths = ensure_models(models_dir)
        self._det = None
        self._rec = None
        self._lm = None
        self._pose = None

    def close(self) -> None:
        """Closes the MediaPipe tasks now (not at interpreter exit, where they print errors)."""
        for t in (self._lm, self._pose):
            if t is not None:
                t.close()
        self._lm = self._pose = None

    # --- YuNet + SFace -------------------------------------------------------------------------------------
    def detect(self, img: np.ndarray, min_score: float = MIN_FACE_SCORE) -> list[Face]:
        import cv2

        h, w = img.shape[:2]
        long = max(h, w)
        # YuNet's anchors top out around 256 px, so a face filling the frame needs a smaller copy: run 1280, 640, 320
        sizes = [min(long, 1280)] + [s for s in (640, 320) if s < long]  # always its own size (at most 1280), then smaller
        if self._det is None:
            self._det = cv2.FaceDetectorYN.create(str(self.paths["yunet"]), "", (320, 320), 0.6, 0.3, 5000)
        rows_all: list[np.ndarray] = []
        for size in sizes:
            scale = min(1.0, size / long)
            small = cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale)))) if scale < 1 else img
            self._det.setInputSize((small.shape[1], small.shape[0]))
            _, rows = self._det.detect(small)
            for r in rows if rows is not None else []:
                r = r.copy()
                r[:14] /= scale
                rows_all.append(r)
        faces = [Face(float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[14]), r) for r in merge_detections(rows_all) if r[14] >= min_score]
        return sorted(faces, key=lambda f: f.area, reverse=True)

    def embed(self, img: np.ndarray, face: Face) -> np.ndarray:
        import cv2

        if self._rec is None:
            self._rec = cv2.FaceRecognizerSF.create(str(self.paths["sface"]), "")
        aligned = self._rec.alignCrop(img, face.row.reshape(1, -1).astype(np.float32))
        return self._rec.feature(aligned).copy()

    def similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        import cv2

        if self._rec is None:
            self._rec = cv2.FaceRecognizerSF.create(str(self.paths["sface"]), "")
        return float(self._rec.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))

    # --- MediaPipe -----------------------------------------------------------------------------------------
    def _mp_image(self, img: np.ndarray):
        import cv2
        import mediapipe as mp

        return mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

    def landmarks(self, img: np.ndarray) -> dict | None:
        """Head pose (degrees), blendshapes and the 478 landmarks of the largest face, or None."""
        from mediapipe.tasks.python import BaseOptions, vision

        if self._lm is None:
            opts = vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_buffer=self.paths["landmarker"].read_bytes()),
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                num_faces=4,
            )
            self._lm = vision.FaceLandmarker.create_from_options(opts)
        res = self._lm.detect(self._mp_image(img))
        if not res.face_landmarks:
            return None
        h, w = img.shape[:2]
        # The largest face (by landmark spread).
        def spread(lms):
            xs = [p.x for p in lms]
            ys = [p.y for p in lms]
            return (max(xs) - min(xs)) * (max(ys) - min(ys))

        i = max(range(len(res.face_landmarks)), key=lambda k: spread(res.face_landmarks[k]))
        m = np.array(res.facial_transformation_matrixes[i])[:3, :3]
        yaw, pitch, roll = _euler(m)
        shapes = {c.category_name: float(c.score) for c in res.face_blendshapes[i]} if res.face_blendshapes else {}
        pts = np.array([[p.x * w, p.y * h] for p in res.face_landmarks[i]])
        return {"yaw": yaw, "pitch": pitch, "roll": roll, "blendshapes": shapes, "points": pts}

    def pose(self, img: np.ndarray) -> list[tuple[float, float, float]] | None:
        """33 body keypoints (x px, y px, visibility) of the main person, or None."""
        from mediapipe.tasks.python import BaseOptions, vision

        if self._pose is None:
            opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_buffer=self.paths["pose"].read_bytes()), num_poses=1)
            self._pose = vision.PoseLandmarker.create_from_options(opts)
        res = self._pose.detect(self._mp_image(img))
        if not res.pose_landmarks:
            return None
        h, w = img.shape[:2]
        return [(p.x * w, p.y * h, float(p.visibility if p.visibility is not None else 0.0)) for p in res.pose_landmarks[0]]


def _euler(r: np.ndarray) -> tuple[float, float, float]:
    """Yaw (left/right), pitch (up/down), roll in degrees from MediaPipe's face rotation matrix."""
    sy = math.hypot(r[0, 0], r[1, 0])
    if sy > 1e-6:
        pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
        yaw = math.degrees(math.atan2(-r[2, 0], sy))
        roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    else:
        pitch = math.degrees(math.atan2(-r[1, 2], r[1, 1]))
        yaw = math.degrees(math.atan2(-r[2, 0], sy))
        roll = 0.0
    return round(yaw, 1), round(pitch, 1), round(roll, 1)


# ---------------------------------------------------------------------------------------------------------------
# Measurements (pure functions on pixels / numbers, tested on their own)

def sharpness(gray_face: np.ndarray) -> float:
    """Variance of the Laplacian on the face scaled to 256 px tall: higher = sharper (comparable between pictures)."""
    import cv2

    h, w = gray_face.shape[:2]
    if h < 8 or w < 8:
        return 0.0
    s = 256 / h
    g = cv2.resize(gray_face, (max(8, round(w * s)), 256), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def lighting(gray_face: np.ndarray, split_x: float) -> dict:
    """Exposure (mean 0-255), clipped highlights / crushed shadows (%), left/right balance (brighter / darker half)."""
    g = gray_face.astype(np.float64)
    x = int(min(max(split_x, 1), g.shape[1] - 1))
    left, right = g[:, :x].mean(), g[:, x:].mean()
    return {
        "exposure": round(float(g.mean()), 1),
        "clipped_pct": round(float((g >= 250).mean() * 100), 1),
        "crushed_pct": round(float((g <= 5).mean() * 100), 1),
        "balance": round(float(max(left, right) / max(1.0, min(left, right))), 2),
    }


BODY = {"shoulders": (11, 12), "hips": (23, 24), "knees": (25, 26), "ankles": (27, 28)}


def body_visibility(points: list[tuple[float, float, float]] | None, size: tuple[int, int]) -> str:
    """'head only' / 'head and shoulders' / 'upper body' / 'down to the knees' / 'full body'."""
    if not points:
        return "head only"
    h, w = size

    def seen(i: int) -> bool:
        x, y, v = points[i]
        return v >= 0.5 and 0 <= x < w and 0 <= y < h

    def pair(name: str) -> bool:
        a, b = BODY[name]
        return seen(a) or seen(b)

    if pair("ankles") and pair("knees") and pair("hips"):
        return "full body"
    if pair("knees") and pair("hips"):
        return "down to the knees"
    if pair("hips"):
        return "upper body"
    if pair("shoulders"):
        return "head and shoulders"
    return "head only"


LEVELS = {"ok": 0, "info": 0, "fix": 1, "bad": 2}
VERDICT = {0: "Ready", 1: "Usable with fix", 2: "Not suitable"}


def verdict(reasons: list[dict]) -> str:
    return VERDICT[max([LEVELS[r["level"]] for r in reasons] or [0])]


def judge_reference(m: dict) -> tuple[list[dict], list[str]]:
    """Plain-language reasons (level ok / info / fix / bad) and the one-click fixes, from the measurements."""
    R: list[dict] = []
    fixes: list[str] = []

    def add(level: str, text: str, key: str) -> None:
        R.append({"level": level, "text": text, "check": key})

    n = m["faces"]
    if n == 0:
        add("bad", "No face found: use a picture where the face is clearly visible.", "faces")
        return R, fixes
    if n > 1:
        if m["second_face_ratio"] < 0.5:
            add("fix", f"{n} faces in the picture; the largest one is used. Crop to that face so the models copy the right person.", "faces")
            fixes.append("crop")
        else:
            add("bad", f"{n} faces of similar size: the app cannot tell which one is the character. Use a picture of her alone, or crop it.", "faces")
            fixes.append("crop")
    else:
        add("ok", f"One face (confidence {m['face_score']:.2f}).", "faces")

    px = m["face_px"]
    if px < MIN_FACE_PX:
        add("bad", f"The face is only {px} px tall: too small to copy faithfully (at least {MIN_FACE_PX} px, best {TARGET_FACE_PX}). Use a closer or larger picture.", "size")
    elif px < TARGET_FACE_PX:
        add("fix", f"The face is {px} px tall (best at least {TARGET_FACE_PX}): upscale it, or use a closer picture.", "size")
        fixes.append("upscale")
    else:
        add("ok", f"The face is {px} px tall.", "size")

    s = m["sharpness"]
    if s < 25:
        add("bad", f"The face is very blurred (sharpness {s:.0f}): use a sharper picture.", "blur")
    elif s < 70:
        add("fix", f"The face is a little soft (sharpness {s:.0f}): fine details may change in the pack; an upscale can help.", "blur")
        if "upscale" not in fixes:
            fixes.append("upscale")
    else:
        add("ok", f"The face is sharp (sharpness {s:.0f}).", "blur")

    lm = m.get("pose")
    if lm is None:
        add("info", "Head pose, expression and landmark checks were not possible (the detailed face model found no face).", "pose")
    else:
        yaw, pitch = abs(lm["yaw"]), abs(lm["pitch"])
        if yaw > 60:
            add("bad", f"The head is in profile ({lm['yaw']:+.0f}°): the identity needs both eyes visible. Use a front or 3/4 picture.", "pose")
        elif yaw > 25 or pitch > 25:
            add("fix", f"The head is turned ({lm['yaw']:+.0f}° left/right, {lm['pitch']:+.0f}° up/down): a straight-on picture copies best. Add a second, front picture.", "pose")
            fixes.append("second_image")
        else:
            add("ok", f"The head faces the camera ({lm['yaw']:+.0f}° / {lm['pitch']:+.0f}°).", "pose")

    vis = m["visible"]
    hidden = [k for k in ("eyes", "nose", "mouth") if not vis[k]]
    if "mouth" in hidden or m.get("hand_over_mouth"):
        add("fix", "The mouth is hidden" + (" by a hand" if m.get("hand_over_mouth") else "") + ": fine for stills, but lip sync needs a visible mouth. Add a second picture with the mouth visible.", "landmarks")
        if "second_image" not in fixes:
            fixes.append("second_image")
    if "eyes" in hidden or "nose" in hidden:
        add("fix", f"Not visible: {', '.join(k for k in hidden if k != 'mouth')}. Add a second picture where they are visible.", "landmarks")
        if "second_image" not in fixes:
            fixes.append("second_image")
    if not hidden and not m.get("hand_over_mouth"):
        add("ok", "Eyes, nose and mouth are visible.", "landmarks")
    add("info", "A veil, hair or a flower over the mouth is not detected automatically: check by eye.", "landmarks")

    ex = m.get("expression")
    if ex:
        if ex["eyes_closed"]:
            add("fix", "The eyes are closed: the models may keep them closed. Add a picture with open eyes.", "expression")
            if "second_image" not in fixes:
                fixes.append("second_image")
        mouth = "open" if ex["mouth_open"] >= 0.35 else "slightly open" if ex["mouth_open"] >= 0.12 else "closed"
        add("info" if mouth != "open" else "fix", f"Expression: mouth {mouth}, eyes {'closed' if ex['eyes_closed'] else 'open'}." + (" A wide-open mouth tends to be copied into every view." if mouth == "open" else ""), "expression")

    li = m["lighting"]
    if li["exposure"] < 55 or li["crushed_pct"] > 20:
        add("fix", f"The face is dark (level {li['exposure']:.0f}/255): details may be invented. A brighter picture copies better.", "lighting")
    elif li["exposure"] > 215 or li["clipped_pct"] > 15:
        add("fix", f"The face is overexposed ({li['clipped_pct']:.0f}% burnt out): skin details are lost.", "lighting")
    else:
        add("ok", f"Exposure is good (level {li['exposure']:.0f}/255).", "lighting")
    if li["balance"] > 1.8:
        add("info", f"Strong light from one side (one half {li['balance']:.1f}x brighter): moody, but the dark side is partly invented in other views.", "lighting")

    add("info", f"Body in the picture: {m['body']}." + ("" if m["body"] == "full body" else " The full-body view will be invented by the model."), "body")
    return R, fixes


def judge_scene(m: dict) -> list[dict]:
    R: list[dict] = []
    short = min(m["width"], m["height"])
    if short < 480:
        R.append({"level": "bad", "text": f"The picture is small ({m['width']}×{m['height']}): use one at least 720 px on its short side.", "check": "size"})
    elif short < 720:
        R.append({"level": "fix", "text": f"The picture is {m['width']}×{m['height']} (best 720 px or more on its short side): upscale it.", "check": "size"})
    else:
        R.append({"level": "ok", "text": f"Size {m['width']}×{m['height']}.", "check": "size"})
    s = m["sharpness"]
    R.append({"level": "bad" if s < 15 else "fix" if s < 45 else "ok", "text": f"Sharpness {s:.0f}" + (" (very blurred)." if s < 15 else " (soft)." if s < 45 else "."), "check": "blur"})
    e = m["exposure"]
    R.append({"level": "fix" if e < 45 or e > 220 else "ok", "text": f"Exposure level {e:.0f}/255" + (" (dark)." if e < 45 else " (bright)." if e > 220 else "."), "check": "lighting"})
    if m["faces"]:
        R.append({"level": "info", "text": f"{m['faces']} face(s) in the location picture: people may appear in every angle.", "check": "faces"})
    return R


# ---------------------------------------------------------------------------------------------------------------
# Commands

def _face_parts(img: np.ndarray, f: Face) -> tuple[np.ndarray, float]:
    import cv2

    h, w = img.shape[:2]
    x0, y0 = max(0, int(f.x)), max(0, int(f.y))
    x1, y1 = min(w, int(f.x + f.w)), min(h, int(f.y + f.h))
    gray = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    nose_x = f.landmarks()["nose"][0] - x0
    return gray, nose_x


def check_reference(kit: FaceKit, path: str) -> dict:
    img = read_image(path)
    h, w = img.shape[:2]
    faces = kit.detect(img)
    m: dict = {"width": w, "height": h, "faces": len(faces)}
    if faces:
        f = faces[0]
        m["face_score"] = round(f.score, 3)
        m["face_px"] = int(round(f.h))
        m["face_box"] = [round(f.x), round(f.y), round(f.w), round(f.h)]
        m["second_face_ratio"] = round(faces[1].area / f.area, 2) if len(faces) > 1 else 0.0
        gray, nose_x = _face_parts(img, f)
        m["sharpness"] = round(sharpness(gray), 1)
        m["lighting"] = lighting(gray, nose_x)
        lm = kit.landmarks(img)
        if lm:
            m["pose"] = {"yaw": lm["yaw"], "pitch": lm["pitch"], "roll": lm["roll"]}
            bs = lm["blendshapes"]
            m["expression"] = {
                "mouth_open": round(bs.get("jawOpen", 0.0), 2),
                "eyes_closed": bs.get("eyeBlinkLeft", 0.0) > 0.6 and bs.get("eyeBlinkRight", 0.0) > 0.6,
                "eye_blink": [round(bs.get("eyeBlinkLeft", 0.0), 2), round(bs.get("eyeBlinkRight", 0.0), 2)],
            }
        else:
            m["pose"] = None
        inside = lambda p: 0 <= p[0] < w and 0 <= p[1] < h  # noqa: E731
        L = f.landmarks()
        yaw = abs(m["pose"]["yaw"]) if m.get("pose") else 0.0
        m["visible"] = {
            "eyes": inside(L["right_eye"]) and inside(L["left_eye"]) and yaw <= 60,
            "nose": inside(L["nose"]),
            "mouth": inside(L["mouth_left"]) and inside(L["mouth_right"]),
        }
        body = kit.pose(img)
        m["body"] = body_visibility(body, (h, w))
        m["hand_over_mouth"] = _hand_over_mouth(body, L, f) if body else False
    reasons, fixes = judge_reference(m)
    return {"file": str(path), "measures": m, "verdict": verdict(reasons), "reasons": reasons, "fixes": fixes}


def _hand_over_mouth(body: list, L: dict, f: Face, min_vis: float = 0.8) -> bool:
    """A confident hand at the mouth: a wrist and at least 2 of its finger points (visibility >= 0.8) within half a
    face height of the mouth. The pose model also guesses hands it cannot see (e.g. at a hat or hair), with medium
    visibility: those are ignored."""
    mx = (L["mouth_left"][0] + L["mouth_right"][0]) / 2
    my = (L["mouth_left"][1] + L["mouth_right"][1]) / 2
    near = lambda i: body[i][2] >= min_vis and math.hypot(body[i][0] - mx, body[i][1] - my) < 0.5 * f.h  # noqa: E731
    for wrist, fingers in ((15, (17, 19, 21)), (16, (18, 20, 22))):
        if near(wrist) and sum(near(i) for i in fingers) >= 2:
            return True
    return False


def check_scene(kit: FaceKit, path: str) -> dict:
    import cv2

    img = read_image(path)
    h, w = img.shape[:2]
    s = 1024 / max(h, w)
    g = cv2.cvtColor(cv2.resize(img, (round(w * s), round(h * s))), cv2.COLOR_BGR2GRAY)
    m = {"width": w, "height": h, "sharpness": round(float(cv2.Laplacian(g, cv2.CV_64F).var()), 1), "exposure": round(float(g.mean()), 1), "faces": len(kit.detect(img))}
    reasons = judge_scene(m)
    return {"file": str(path), "measures": m, "verdict": verdict(reasons), "reasons": reasons}


def _reference_print(kit: FaceKit, ref: str) -> tuple[np.ndarray, np.ndarray]:
    img = read_image(ref)
    faces = kit.detect(img)
    if not faces:
        raise ValueError(f"No face found in {Path(ref).name}: the face finder needs a clearly visible face (not in profile, not covered). Try a front or 3/4 picture, or crop closer.")
    return img, kit.embed(img, faces[0])


def compare(kit: FaceKit, ref: str, files: list[str]) -> dict:
    """The reference's face vs the largest face of each picture: cosine similarity, face size, head turn."""
    _, ref_f = _reference_print(kit, ref)
    out = []
    for p in files:
        try:
            img = read_image(p)
            faces = kit.detect(img, min_score=0.6)
            if not faces:
                out.append({"file": p, "score": None, "note": "no face found"})
                continue
            f = faces[0]
            try:
                lm = kit.landmarks(img)
            except Exception:  # noqa: BLE001 - the score does not need it
                lm = None
            out.append({"file": p, "score": round(kit.similarity(ref_f, kit.embed(img, f)), 3), "face_px": int(round(f.h)), "yaw": lm["yaw"] if lm else None})
        except Exception as e:  # noqa: BLE001
            out.append({"file": p, "score": None, "note": str(e)})
    return {"reference": ref, "results": out}


def _frames(path: Path, per_second: float = 1.0, max_frames: int = 12) -> list[np.ndarray]:
    import cv2

    if path.suffix.lower() in IMAGE_EXT:
        return [read_image(path)]
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(round(fps / per_second)))
    frames = []
    for i in range(0, max(total, 1), step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
        if len(frames) >= max_frames:
            break
    cap.release()
    return frames


def _expand(items: list[str]) -> list[Path]:
    files: list[Path] = []
    for it in items:
        p = Path(it)
        if p.is_dir():
            files += sorted(q for q in p.iterdir() if q.suffix.lower() in VIDEO_EXT | IMAGE_EXT and not q.name.startswith("."))
        elif p.exists():
            files.append(p)
    return files


def _same_picture_variants(img: np.ndarray) -> dict[str, np.ndarray]:
    """The reference changed the way a copy of the same face changes (size, light, angle, compression, blur)."""
    import cv2

    h, w = img.shape[:2]
    out = {"mirrored": cv2.flip(img, 1)}
    for s in (0.5, 0.3):
        out[f"{int(s * 100)}% size"] = cv2.resize(img, (max(16, int(w * s)), max(16, int(h * s))), interpolation=cv2.INTER_AREA)
    out["darker"] = cv2.convertScaleAbs(img, alpha=0.6, beta=0)
    out["brighter"] = cv2.convertScaleAbs(img, alpha=1.3, beta=20)
    for a in (-10, 10):
        M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1.0)
        out[f"tilted {a:+d} deg"] = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REFLECT)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 35])
    out["heavy JPEG"] = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    out["blurred"] = cv2.GaussianBlur(img, (0, 0), 2.0)
    return out


COPY_FROM = 0.6  # an unmarked clip this alike is almost certainly the reference picture itself (or a copy of it)


def clip_role(name: str, best: float | None, her_names: list[str] | None) -> str:
    """'her' = marked by the user (the file name equals or contains one of her names, any case); 'copy' = not marked but
    scoring >= 0.6 (the reference picture itself or a copy); otherwise 'other'."""
    low = name.lower()
    if any(h.strip() and h.strip().lower() in low for h in her_names or []):
        return "her"
    if best is not None and best >= COPY_FROM:
        return "copy"
    return "other"


def thresholds(other_best: list[float], same_scores: list[float], her_best: list[float] | None = None, copies: int = 0) -> dict:
    """Green / amber / red from the user's own pictures.

    other_best = best score of every clip of OTHER people (clips marked as her and copies of the reference are not in it).
    red   = below the best score any other person reached + 0.03 (it could be anyone)
    green = at least SFace's own line (0.363) and at least 0.10 above the best other person
    amber = in between: check by eye
    """
    others = list(other_best)
    her = list(her_best or [])
    top_other = max(others) if others else 0.0
    red_below = round(max(0.20, top_other + 0.03), 3)
    green_from = round(max(SFACE_SAME, top_other + 0.10), 3)
    green_from = max(green_from, red_below)
    low_same = min(same_scores) if same_scores else None
    her_range = [round(min(her), 3), round(max(her), 3)] if her else None
    overlap = any(h < green_from for h in her)
    notes = []
    if not others:
        notes.append("No other woman's face was found to compare with: the thresholds are SFace's defaults.")
    if overlap and her_range:
        notes.append(
            f"The face check cannot reliably tell her from some other women here: her own clips score {her_range[0]:.2f}\u2013{her_range[1]:.2f}, "
            f"other women up to {top_other:.2f}. Green means very likely her; amber and red mean check by eye before regenerating."
        )
    if low_same is not None and low_same < green_from:
        notes.append(f"Some changed copies of the reference itself score only {low_same:.2f}: a small or blurred face can land in amber even when it is her.")
    return {
        "red_below": red_below,
        "green_from": green_from,
        "top_other": round(top_other, 3),
        "others_used": len(others),
        "her_used": len(her),
        "her_range": her_range,
        "copies": copies,
        "overlap": overlap,
        "lowest_same": round(low_same, 3) if low_same is not None else None,
        "sface_default": SFACE_SAME,
        "note": " ".join(notes) or None,
    }


def calibrate(kit: FaceKit, ref: str, others: list[str], her: list[str] | None = None) -> dict:
    ref_img, ref_f = _reference_print(kit, ref)
    same = []
    for name, v in _same_picture_variants(ref_img).items():
        faces = kit.detect(v, min_score=0.6)
        same.append({"variant": name, "score": round(kit.similarity(ref_f, kit.embed(v, faces[0])), 3) if faces else None})
    rows = []
    for p in _expand(others):
        scores = []
        frames = _frames(p)
        for fr in frames:
            for f in kit.detect(fr):
                if f.h >= 48:
                    scores.append(kit.similarity(ref_f, kit.embed(fr, f)))
        rows.append({"file": str(p), "frames": len(frames), "faces": len(scores), "best": round(max(scores), 3) if scores else None, "mean": round(float(np.mean(scores)), 3) if scores else None})
    rows.sort(key=lambda r: -(r["best"] if r["best"] is not None else -9))
    for r in rows:
        r["role"] = clip_role(Path(r["file"]).stem, r["best"], her)
        r["probably_same"] = r["role"] != "other"
    scored = [r for r in rows if r["best"] is not None]
    t = thresholds(
        [r["best"] for r in scored if r["role"] == "other"],
        [s["score"] for s in same if s["score"] is not None],
        [r["best"] for r in scored if r["role"] == "her"],
        sum(1 for r in rows if r["role"] == "copy"),
    )
    return {"reference": ref, "same_picture": same, "others": rows, "thresholds": t}


def crop_face(kit: FaceKit, path: str, out: str, aspect: float = 3 / 4, margin: float = 2.2) -> dict:
    """Crops around the largest face: about `margin` face heights tall (head, hair and shoulders), 3:4."""
    img = read_image(path)
    h, w = img.shape[:2]
    faces = kit.detect(img)
    if not faces:
        raise ValueError("no face to crop to")
    f = faces[0]
    ch = min(h, f.h * margin)
    cw = min(w, ch * aspect)
    ch = min(ch, cw / aspect)
    cx, cy = f.x + f.w / 2, f.y + f.h * 0.55
    x0 = int(min(max(0, cx - cw / 2), w - cw))
    y0 = int(min(max(0, cy - ch / 2), h - ch))
    crop = img[y0 : y0 + int(ch), x0 : x0 + int(cw)]
    write_image(out, crop)
    return {"file": out, "box": [x0, y0, int(cw), int(ch)]}


def contact_sheet(spec: dict) -> dict:
    """spec = {out, title, rows: [{label, cells: [{file, caption, colour}]}]}: one row per model, labelled thumbnails."""
    import cv2

    H = int(spec.get("height", 360))
    pad, cap_h, label_w = 8, 46, 210
    colours = {"green": (80, 175, 76), "amber": (0, 165, 255), "red": (60, 60, 220), "grey": (140, 140, 140)}
    rows_img = []
    for row in spec["rows"]:
        cells = []
        for c in row["cells"]:
            try:
                im = read_image(c["file"])
                im = cv2.resize(im, (max(1, int(im.shape[1] * H / im.shape[0])), H), interpolation=cv2.INTER_AREA)
            except Exception:  # noqa: BLE001
                im = np.full((H, int(H * 0.75), 3), 40, np.uint8)
                cv2.putText(im, "missing", (10, H // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
            bar = np.full((cap_h, im.shape[1], 3), 24, np.uint8)
            col = colours.get(c.get("colour", "grey"), colours["grey"])
            cv2.rectangle(bar, (0, 0), (8, cap_h), col, -1)
            for k, line in enumerate(str(c.get("caption", "")).split("\n")[:2]):
                cv2.putText(bar, line[:40], (14, 18 + k * 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
            cells.append(np.vstack([im, bar]))
        label = np.full((H + cap_h, label_w, 3), 16, np.uint8)
        for k, line in enumerate(str(row.get("label", "")).split("\n")[:4]):
            cv2.putText(label, line[:22], (10, 30 + k * 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        parts = [label]
        for c in cells:
            parts += [np.full((H + cap_h, pad, 3), 16, np.uint8), c]
        rows_img.append(np.hstack(parts))
    width = max(r.shape[1] for r in rows_img)
    rows_img = [np.hstack([r, np.full((r.shape[0], width - r.shape[1], 3), 16, np.uint8)]) for r in rows_img]
    title = np.full((48, width, 3), 16, np.uint8)
    cv2.putText(title, str(spec.get("title", ""))[:120], (10, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
    sheet = np.vstack([title] + sum([[r, np.full((pad, width, 3), 16, np.uint8)] for r in rows_img], []))
    write_image(spec["out"], sheet, 90)
    return {"file": spec["out"], "width": int(sheet.shape[1]), "height": int(sheet.shape[0])}


def main(argv: list[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="face", description="Local face checks for Characters (prints JSON).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("models")
    a = sub.add_parser("check")
    a.add_argument("image")
    a = sub.add_parser("scene-check")
    a.add_argument("image")
    a = sub.add_parser("compare")
    a.add_argument("reference")
    a.add_argument("files", nargs="+")
    a = sub.add_parser("calibrate")
    a.add_argument("reference")
    a.add_argument("others", nargs="+")
    a.add_argument("--her", action="append", default=[])
    a = sub.add_parser("crop")
    a.add_argument("image")
    a.add_argument("out")
    a = sub.add_parser("sheet")
    a.add_argument("spec_json")
    args = ap.parse_args(argv)

    if args.cmd == "sheet":
        result = contact_sheet(json.loads(Path(args.spec_json).read_text(encoding="utf-8")))
    else:
        kit = FaceKit()
        if args.cmd == "models":
            result = {k: str(v) for k, v in kit.paths.items()}
        elif args.cmd == "check":
            result = check_reference(kit, args.image)
        elif args.cmd == "scene-check":
            result = check_scene(kit, args.image)
        elif args.cmd == "compare":
            result = compare(kit, args.reference, args.files)
        elif args.cmd == "calibrate":
            result = calibrate(kit, args.reference, args.others, args.her)
        else:
            result = crop_face(kit, args.image, args.out)
    for s in (sys.stdout, sys.stderr):  # Windows pipes default to the ANSI code page, so force UTF-8
        reconfigure = getattr(s, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, default=_plain))
    if args.cmd != "sheet":
        kit.close()
    return 0


def _plain(o):
    """numpy numbers and booleans as plain JSON."""
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o).__name__)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
