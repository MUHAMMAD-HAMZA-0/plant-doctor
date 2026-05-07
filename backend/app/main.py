import base64
import json
import logging
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import AliasChoices, BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from ultralytics import FastSAM, YOLO


logger = logging.getLogger("plant_scanner")
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Plant Scanner Backend"
    app_version: str = "2.0.0"
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("GEMINI_VISION_MODEL", "GEMINI_MODEL"),
    )
    segmentation_model_path: str = Field(
        default="FastSAM-s.pt",
        validation_alias=AliasChoices("SEGMENTATION_MODEL_PATH", "segmentation_model_path"),
    )
    leaf_detector_model_path: str = Field(
        default="backend/app/models/leaf_detector.pt",
        validation_alias=AliasChoices("LEAF_DETECTOR_MODEL_PATH", "leaf_detector_model_path"),
    )
    upload_dir: str = Field(default="backend/storage/uploads", validation_alias="UPLOAD_DIR")
    yolo_confidence: float = Field(default=0.12, validation_alias="YOLO_CONFIDENCE")
    yolo_iou: float = Field(default=0.5, validation_alias="YOLO_IOU")
    yolo_imgsz: int = Field(default=1280, validation_alias="YOLO_IMGSZ")
    yolo_max_det: int = Field(default=48, validation_alias="YOLO_MAX_DET")
    yolo_augment: bool = Field(default=False, validation_alias="YOLO_AUGMENT")
    min_polygon_area_ratio: float = Field(
        default=0.0012,
        validation_alias=AliasChoices("MIN_POLYGON_AREA_RATIO", "YOLO_MIN_BOX_AREA_RATIO"),
    )
    max_leaves_for_ai: int = Field(default=24, validation_alias="MAX_LEAVES_FOR_AI")
    allowed_origins: list[str] = ["*"]

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def model_path(self) -> Path:
        configured = (self.segmentation_model_path or "").strip()
        legacy = (self.leaf_detector_model_path or "").strip()
        resolved = configured or legacy or "FastSAM-s.pt"
        path = Path(resolved)
        if not path.is_absolute() and len(path.parts) > 1:
            path = PROJECT_ROOT / path
        return path

    @property
    def model_reference(self) -> str:
        configured = (self.segmentation_model_path or "").strip()
        legacy = (self.leaf_detector_model_path or "").strip()
        return configured or legacy or "FastSAM-s.pt"


settings = Settings()


class LeafReport(BaseModel):
    status: str = Field(default="Unknown")
    diseaseName: str = Field(default="Unknown")
    details: str = Field(default="No details provided.")
    remedy: str = Field(default="No remedy provided.")


class LeafItem(BaseModel):
    leafId: str
    polygon: list[list[float]]
    report: LeafReport


class AnalyzeResponse(BaseModel):
    success: bool
    imageWidth: int
    imageHeight: int
    leaves: list[LeafItem]
    aiWarning: str | None = None


app = FastAPI(title=settings.app_name, version=settings.app_version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_model_cache: FastSAM | YOLO | None = None


def get_model() -> FastSAM | YOLO:
    global _model_cache
    if _model_cache is not None:
        return _model_cache
    model_ref = settings.model_reference
    model_path = settings.model_path
    if "fastsam" in Path(model_ref).name.lower():
        # Ultralytics can auto-download FastSAM weights when referenced by name.
        _model_cache = FastSAM(model_ref if len(Path(model_ref).parts) == 1 else str(model_path))
    else:
        if not model_path.exists():
            raise FileNotFoundError(
                f"Segmentation model not found at '{model_path.as_posix()}'. "
                "Set SEGMENTATION_MODEL_PATH to a FastSAM or YOLO segmentation model."
            )
        _model_cache = YOLO(str(model_path))
    return _model_cache


def decode_upload(raw_bytes: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(raw_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode uploaded image.")
    return image


def contour_to_polygon(points: np.ndarray) -> list[list[float]]:
    if points.size == 0:
        return []
    contour = points.astype(np.float32).reshape(-1, 2)
    polygon = [[round(float(x), 2), round(float(y), 2)] for x, y in contour]
    return polygon if len(polygon) >= 3 else []


@dataclass
class MaskCandidate:
    polygon: list[list[float]]
    mask: np.ndarray
    area: float
    bbox: tuple[int, int, int, int]
    confidence: float
    vegetation_ratio: float
    extent: float
    slenderness: float
    score: float
    centroid: tuple[int, int]


def mask_to_polygon(mask: np.ndarray, image_width: int, image_height: int) -> list[list[float]]:
    """
    Convert a binary mask into an exact polygon using every contour pixel.
    Bounding boxes are intentionally not used here.
    """
    if mask.ndim != 2:
        raise ValueError("mask_to_polygon expects a 2D binary mask.")

    mask_uint8 = ((mask > 0).astype(np.uint8)) * 255
    if mask_uint8.shape[1] != image_width or mask_uint8.shape[0] != image_height:
        mask_uint8 = cv2.resize(mask_uint8, (image_width, image_height), interpolation=cv2.INTER_NEAREST)

    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []

    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 10:
        return []

    return contour_to_polygon(contour)


def polygon_area(polygon: list[list[float]]) -> float:
    if len(polygon) < 3:
        return 0.0
    points = np.array(polygon, dtype=np.float32)
    return float(abs(cv2.contourArea(points)))


def build_vegetation_mask(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    image_float = image.astype(np.float32)
    b_channel, g_channel, r_channel = cv2.split(image_float)

    excess_green = (2.0 * g_channel) - r_channel - b_channel
    excess_green = cv2.normalize(excess_green, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    _, excess_green_mask = cv2.threshold(
        excess_green,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )

    green_mask = cv2.inRange(hsv, (20, 25, 20), (100, 255, 255))
    warm_leaf_mask = cv2.inRange(hsv, (10, 20, 20), (40, 255, 255))
    vegetation_mask = cv2.bitwise_or(excess_green_mask, green_mask)
    vegetation_mask = cv2.bitwise_or(vegetation_mask, warm_leaf_mask)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    vegetation_mask = cv2.morphologyEx(vegetation_mask, cv2.MORPH_OPEN, kernel)
    vegetation_mask = cv2.morphologyEx(vegetation_mask, cv2.MORPH_CLOSE, kernel)
    return vegetation_mask > 0


def create_mask_candidate(
    mask: np.ndarray,
    image_width: int,
    image_height: int,
    vegetation_mask: np.ndarray,
    confidence: float,
    image_area: float,
) -> MaskCandidate | None:
    polygon = mask_to_polygon(mask, image_width, image_height)
    if not polygon:
        return None

    contour = np.array(polygon, dtype=np.float32)
    area = polygon_area(polygon)
    if area <= 0:
        return None

    min_area_ratio = max(settings.min_polygon_area_ratio, 0.0012)
    if area / image_area < min_area_ratio:
        return None
    if area / image_area < 0.004:
        return None

    x, y, width, height = cv2.boundingRect(contour.astype(np.int32))
    if width < 18 or height < 18:
        return None
    if area / image_area > 0.08:
        return None

    bbox_area = float(max(width * height, 1))
    extent = min(1.0, area / bbox_area)
    slenderness = min(width, height) / max(width, height)

    candidate_mask = np.zeros((image_height, image_width), dtype=np.uint8)
    cv2.fillPoly(candidate_mask, [contour.astype(np.int32)], 255)
    candidate_mask_bool = candidate_mask > 0
    mask_area_pixels = float(max(candidate_mask_bool.sum(), 1))
    vegetation_ratio = float(np.logical_and(candidate_mask_bool, vegetation_mask).sum() / mask_area_pixels)

    touches_border = x <= 2 or y <= 2 or (x + width) >= (image_width - 2) or (y + height) >= (image_height - 2)
    if touches_border and (
        area / image_area < 0.012
        or width / image_width > 0.22
        or height / image_height > 0.22
        or min(width, height) < 28
    ):
        return None
    if vegetation_ratio < 0.45:
        return None
    if extent < 0.28:
        return None
    if slenderness < 0.1:
        return None
    if confidence < 0.2 and area / image_area < 0.004:
        return None

    centroid_y, centroid_x = np.argwhere(candidate_mask_bool).mean(axis=0)
    centroid = (int(round(centroid_x)), int(round(centroid_y)))

    score = (
        confidence * 0.45
        + vegetation_ratio * 0.35
        + min(area / image_area, 0.03) / 0.03 * 0.20
    )
    return MaskCandidate(
        polygon=polygon,
        mask=candidate_mask_bool,
        area=area,
        bbox=(x, y, width, height),
        confidence=confidence,
        vegetation_ratio=vegetation_ratio,
        extent=extent,
        slenderness=slenderness,
        score=score,
        centroid=centroid,
    )


def bbox_iou(box_a: tuple[int, int, int, int], box_b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    a_x2 = ax + aw
    a_y2 = ay + ah
    b_x2 = bx + bw
    b_y2 = by + bh

    inter_x1 = max(ax, bx)
    inter_y1 = max(ay, by)
    inter_x2 = min(a_x2, b_x2)
    inter_y2 = min(a_y2, b_y2)
    if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
        return 0.0

    intersection = float((inter_x2 - inter_x1) * (inter_y2 - inter_y1))
    area_a = float(max(aw * ah, 1))
    area_b = float(max(bw * bh, 1))
    return intersection / max(area_a + area_b - intersection, 1.0)


def masks_overlap_too_much(mask_a: np.ndarray, mask_b: np.ndarray) -> bool:
    intersection = float(np.logical_and(mask_a, mask_b).sum())
    if intersection <= 0:
        return False

    union = float(np.logical_or(mask_a, mask_b).sum())
    smaller = float(min(mask_a.sum(), mask_b.sum()))
    iou = intersection / max(union, 1.0)
    containment = intersection / max(smaller, 1.0)
    return iou >= 0.28 or containment >= 0.82


def select_leaf_candidates(candidates: list[MaskCandidate]) -> list[MaskCandidate]:
    selected: list[MaskCandidate] = []
    for candidate in sorted(
        candidates,
        key=lambda item: (item.score, item.area, item.confidence),
        reverse=True,
    ):
        candidate_x, candidate_y = candidate.centroid
        if any(
            masks_overlap_too_much(candidate.mask, kept.mask)
            or bbox_iou(candidate.bbox, kept.bbox) >= 0.55
            or (
                0 <= candidate_y < kept.mask.shape[0]
                and 0 <= candidate_x < kept.mask.shape[1]
                and kept.mask[candidate_y, candidate_x]
                and candidate.area <= kept.area * 0.92
            )
            for kept in selected
        ):
            continue
        selected.append(candidate)
    return selected


def detect_leaf_polygons(image: np.ndarray) -> list[list[list[float]]]:
    model = get_model()
    model_name = Path(settings.model_reference).name.lower()
    effective_confidence = max(settings.yolo_confidence, 0.12)
    effective_iou = min(settings.yolo_iou, 0.5)
    effective_max_det = min(settings.yolo_max_det, 48)
    effective_augment = settings.yolo_augment and "fastsam" not in model_name
    results = model.predict(
        source=image,
        conf=effective_confidence,
        iou=effective_iou,
        imgsz=settings.yolo_imgsz,
        max_det=effective_max_det,
        augment=effective_augment,
        retina_masks=True,
        verbose=False,
    )
    if not results:
        return []

    result = results[0]
    masks = getattr(result, "masks", None)
    image_height, image_width = image.shape[:2]
    image_area = float(max(image_height * image_width, 1))
    vegetation_mask = build_vegetation_mask(image)

    polygons: list[list[list[float]]] = []

    if masks is not None and getattr(masks, "data", None) is not None:
        mask_data = masks.data.cpu().numpy()
        box_confidences: list[float] = []
        boxes = getattr(result, "boxes", None)
        if boxes is not None and getattr(boxes, "conf", None) is not None:
            box_confidences = [float(value) for value in boxes.conf.cpu().tolist()]
        if len(box_confidences) < len(mask_data):
            box_confidences.extend([0.5] * (len(mask_data) - len(box_confidences)))

        candidates: list[MaskCandidate] = []
        for index, mask_tensor in enumerate(mask_data):
            candidate = create_mask_candidate(
                mask=mask_tensor,
                image_width=image_width,
                image_height=image_height,
                vegetation_mask=vegetation_mask,
                confidence=box_confidences[index],
                image_area=image_area,
            )
            if candidate is not None:
                candidates.append(candidate)

        selected = select_leaf_candidates(candidates)
        polygons = [candidate.polygon for candidate in selected]
        logger.info(
            "Mask filtering kept %s of %s raw masks as leaf candidates.",
            len(polygons),
            len(mask_data),
        )
    else:
        logger.warning("Segmentation model returned no masks; rectangle box fallback is disabled.")

    polygons.sort(key=polygon_area, reverse=True)
    return polygons


def create_leaf_crop(image: np.ndarray, polygon: list[list[float]]) -> bytes:
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    polygon_np = np.array(polygon, dtype=np.int32)
    cv2.fillPoly(mask, [polygon_np], 255)

    x, y, width, height = cv2.boundingRect(polygon_np)
    masked = cv2.bitwise_and(image, image, mask=mask)
    crop_bgr = masked[y : y + height, x : x + width]
    crop_mask = mask[y : y + height, x : x + width]

    crop_rgba = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGBA)
    crop_rgba[:, :, 3] = crop_mask

    pil_image = Image.fromarray(crop_rgba)
    buffer = BytesIO()
    pil_image.save(buffer, format="PNG")
    return buffer.getvalue()


def parse_gemini_leaf_reports(raw_text: str, expected_count: int) -> list[LeafReport]:
    text = raw_text.strip()
    if not text:
        raise ValueError("Gemini returned an empty response.")

    parsed: object
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start < 0 or end <= start:
            raise ValueError("Gemini response was not valid JSON.")
        parsed = json.loads(text[start : end + 1])

    if not isinstance(parsed, list):
        raise ValueError("Gemini response must be a JSON array.")

    reports: list[LeafReport] = []
    for item in parsed:
        if not isinstance(item, dict):
            item = {}
        reports.append(
            LeafReport(
                status=str(item.get("status") or "Unknown"),
                diseaseName=str(item.get("diseaseName") or "Unknown"),
                details=str(item.get("details") or "No details provided."),
                remedy=str(item.get("remedy") or "No remedy provided."),
            )
        )

    while len(reports) < expected_count:
        reports.append(LeafReport())
    return reports[:expected_count]


async def analyze_crops_with_gemini(crops: list[bytes]) -> list[LeafReport]:
    if not crops:
        return []

    api_key = settings.gemini_api_key.strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured.")

    parts: list[dict[str, object]] = [
        {
            "text": (
                "You are analyzing cropped plant leaves one by one. "
                "Return ONLY a strict JSON array. "
                "Array order must exactly match the image order. "
                "Each item must match this schema: "
                '{"status":"Healthy | Infected","diseaseName":"short disease name or Healthy",'
                '"details":"1-2 sentence summary","remedy":"concise actionable remedy"}.'
            ),
        }
    ]

    for index, crop in enumerate(crops, start=1):
        parts.append({"text": f"Leaf {index}"})
        parts.append(
            {
                "inlineData": {
                    "mimeType": "image/png",
                    "data": base64.b64encode(crop).decode("ascii"),
                }
            }
        )

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1800,
        },
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    response_parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    message = "\n".join(
        part.get("text", "") for part in response_parts if isinstance(part, dict)
    ).strip()
    return parse_gemini_leaf_reports(message or "", len(crops))


def build_fallback_reports(count: int, reason: str) -> list[LeafReport]:
    return [
        LeafReport(
            status="Unknown",
            diseaseName="AI analysis unavailable",
            details="Leaf was detected successfully, but cloud classification could not be completed.",
            remedy=f"Retry analysis after fixing AI backend issue. Reason: {reason}",
        )
        for _ in range(count)
    ]


@app.get("/health")
async def health() -> dict[str, str | bool]:
    model_ref = settings.model_reference
    model_name = Path(model_ref).name.lower()
    return {
        "status": "ok",
        "modelReady": settings.model_path.exists() or "fastsam" in model_name,
        "modelPath": settings.model_path.as_posix(),
    }


@app.post("/api/analyze-plant", response_model=AnalyzeResponse)
async def analyze_plant(image: UploadFile = File(...)) -> AnalyzeResponse:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    try:
        raw_bytes = await image.read()
        frame = decode_upload(raw_bytes)
        image_height, image_width = frame.shape[:2]

        polygons = detect_leaf_polygons(frame)
        if not polygons:
            raise HTTPException(status_code=422, detail="No leaves were detected in the image.")

        upload_id = uuid4().hex
        image_path = settings.upload_path / f"{upload_id}.jpg"
        image_path.write_bytes(raw_bytes)

        limited_polygons = polygons[: settings.max_leaves_for_ai]
        crops = [create_leaf_crop(frame, polygon) for polygon in limited_polygons]
        ai_warning: str | None = None
        try:
            reports = await analyze_crops_with_gemini(crops)
        except Exception as exc:
            logger.exception("Gemini analysis failed")
            ai_warning = str(exc)
            reports = build_fallback_reports(len(crops), ai_warning)

        leaves = [
            LeafItem(
                leafId=f"leaf_{index + 1}",
                polygon=polygon,
                report=reports[index],
            )
            for index, polygon in enumerate(limited_polygons)
        ]

        return AnalyzeResponse(
            success=True,
            imageWidth=image_width,
            imageHeight=image_height,
            leaves=leaves,
            aiWarning=ai_warning,
        )
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Leaf analysis failed")
        raise HTTPException(status_code=500, detail=f"Leaf analysis failed: {exc}") from exc
