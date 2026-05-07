import base64
import logging
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.schemas.analysis import LeafAnalysis, LeafDetection, LeafSegment, PlantAnalysisResponse, PolygonPoint
from app.services.detector import LeafDetector
from app.services.gemini import GeminiLeafAnalyzer
from app.services.image_processing import crop_detection, load_image, save_crop
from app.services.local_analyzer import LocalLeafAnalyzer
from app.services.summarizer import build_summary
from app.core.config import get_settings


logger = logging.getLogger(__name__)
router = APIRouter(tags=["analysis"])

detector = LeafDetector()
gemini = GeminiLeafAnalyzer()
local_analyzer = LocalLeafAnalyzer()


def normalize_confidence(value: object, default: float = 0.0) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        confidence = default
    if confidence > 1:
        confidence = confidence / 100
    return max(0.0, min(confidence, 1.0))


def describe_ai_error(exc: Exception) -> tuple[str, bool]:
    """
    Return a user-safe reason and whether cloud calls should be disabled
    for the rest of this request.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            return ("Gemini rate limit reached (429).", True)
        if code in (401, 403):
            return ("Gemini API key is invalid or lacks required permissions.", True)
        if code in (400, 404):
            return ("Gemini model configuration is invalid for this API key.", True)
        if 500 <= code <= 599:
            return ("Gemini service is temporarily unavailable.", False)
        return (f"Gemini HTTP error ({code}).", False)

    message = str(exc).strip()
    if "timeout" in message.lower():
        return ("Gemini request timed out.", False)
    if message:
        return (message[:180], False)
    return ("Unknown cloud analysis error.", False)


@router.post("/analyze-plant", response_model=PlantAnalysisResponse)
async def analyze_plant(image: UploadFile = File(...)) -> PlantAnalysisResponse:
    print(f"[API] === New Request Received ===")
    print(f"[API] Image filename: {image.filename}")
    print(f"[API] Image content_type: {image.content_type}")
    
    if not image.content_type or not image.content_type.startswith("image/"):
        print(f"[API] Error: Invalid content type: {image.content_type}")
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    settings = get_settings()
    image_id = uuid4().hex
    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    image_path = settings.upload_path / f"{image_id}{suffix}"
    
    print(f"[API] Reading image data...")
    raw_bytes = await image.read()
    print(f"[API] Image size: {len(raw_bytes)} bytes")
    
    print(f"[API] Saving to: {image_path}")
    image_path.write_bytes(raw_bytes)
    print(f"[API] Image saved successfully")

    try:
        print(f"[API] Running leaf detection...")
        detections_raw = detector.detect(image_path)
        print(f"[API] Detection complete: {len(detections_raw)} leaves found")
    except FileNotFoundError as exc:
        print(f"[API] Error: File not found: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[API] Error: Detection failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Detection failed: {exc}") from exc

    if not detections_raw:
        print(f"[API] Warning: No leaves detected")
        raise HTTPException(
            status_code=422,
            detail="No leaves were detected. Check your trained YOLO model or image quality.",
        )

    try:
        print(f"[API] Loading full image for cropping...")
        full_image = load_image(image_path)
    except Exception as exc:
        print(f"[API] Error: Failed to load image: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    detections: list[LeafDetection] = []
    analyses: list[LeafAnalysis] = []
    cloud_disabled_for_request = False
    cloud_disable_reason = ""

    for detection in detections_raw:
        leaf_id = detection["leafId"]
        try:
            crop = crop_detection(full_image, detection["bbox_pixels"])
            crop_path = settings.upload_path / image_id / f"{leaf_id}.jpg"
            save_crop(crop, crop_path)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Crop generation failed for {leaf_id}: {exc}",
            ) from exc

        crop_bytes = base64.b64encode(crop_path.read_bytes())
        try:
            if cloud_disabled_for_request:
                raise RuntimeError(cloud_disable_reason or "Cloud analysis unavailable for this request.")
            gemini_result = await gemini.analyze_leaf(crop_bytes)
        except Exception as exc:
            reason, should_disable = describe_ai_error(exc)
            if should_disable:
                cloud_disabled_for_request = True
                cloud_disable_reason = reason
            gemini_result = local_analyzer.analyze_leaf(crop_path)
            gemini_result.setdefault(
                "observations",
                [],
            )
            gemini_result["observations"].append(
                f"Cloud analysis fallback reason: {reason}."
            )

        # Build segmentation from contour
        contour = detection.get("contour", [])
        segmentation = LeafSegment(
            contour=[PolygonPoint(x=p["x"], y=p["y"]) for p in contour],
            bbox=detection.get("bbox"),
        )

        detections.append(
            LeafDetection(
                leafId=leaf_id,
                bbox=detection.get("bbox"),
                segmentation=segmentation,
                confidence=detection["confidence"],
                cropPath=str(crop_path.as_posix()),
            )
        )
        analyses.append(
            LeafAnalysis(
                leafId=leaf_id,
                condition=str(gemini_result.get("condition", "unknown")),
                severity=str(gemini_result.get("severity", "unknown")),
                confidence=normalize_confidence(gemini_result.get("confidence", 0.0)),
                observations=[
                    str(item).strip()
                    for item in gemini_result.get("observations", [])
                    if str(item).strip()
                ],
                recommendation=(
                    str(gemini_result.get("recommendation")).strip()
                    if gemini_result.get("recommendation") is not None
                    else None
                ),
            )
        )

    try:
        summary = build_summary(analyses)
        return PlantAnalysisResponse(
            imageId=image_id,
            detections=detections,
            analyses=analyses,
            summary=summary,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Response serialization failed: {exc}",
        ) from exc
