from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from app.core.config import get_settings


class LeafDetector:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._model: YOLO | None = None

    def _fallback_detection(self, image_path: Path) -> list[dict]:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Unable to read image '{image_path}'.")

        image_height, image_width = image.shape[:2]
        inset_x = max(int(round(image_width * 0.03)), 1)
        inset_y = max(int(round(image_height * 0.03)), 1)
        x1 = inset_x
        y1 = inset_y
        x2 = max(image_width - inset_x, x1 + 1)
        y2 = max(image_height - inset_y, y1 + 1)

        return [
            {
                "leafId": "leaf_1",
                "bbox_pixels": {
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                },
                "bbox": {
                    "x": round(x1 / image_width, 6),
                    "y": round(y1 / image_height, 6),
                    "width": round((x2 - x1) / image_width, 6),
                    "height": round((y2 - y1) / image_height, 6),
                },
                "contour": [
                    {"x": x1, "y": y1},
                    {"x": x2, "y": y1},
                    {"x": x2, "y": y2},
                    {"x": x1, "y": y2},
                ],
                "confidence": 0.2,
            }
        ]

    def _get_model(self) -> YOLO:
        if self._model is None:
            model_path = self.settings.detector_model_path
            if not model_path.exists():
                raise FileNotFoundError(
                    "Leaf detector model is missing. "
                    f"Expected path: '{model_path.as_posix()}'. "
                    "Place your trained YOLO leaf detector there or update LEAF_DETECTOR_MODEL_PATH in backend/.env."
                )
            self._model = YOLO(str(model_path))
        return self._model

    def _polygon_to_points(self, polygon: np.ndarray) -> list[dict[str, float]]:
        """Preserve the full segmentation polygon without OpenCV simplification."""
        if polygon.size == 0:
            return []

        polygon = polygon.astype(np.float32).reshape(-1, 2)

        points = [
            {"x": round(float(point[0]), 2), "y": round(float(point[1]), 2)}
            for point in polygon
        ]
        return points if len(points) >= 3 else []

    def detect(self, image_path: Path) -> list[dict]:
        try:
            model = self._get_model()
            print(f"[YOLO] Model loaded successfully from: {self.settings.detector_model_path}")
        except FileNotFoundError as e:
            print(f"[YOLO] Model not found, using fallback detection: {e}")
            return self._fallback_detection(image_path)

        # Use instance segmentation (seg mode) with tuned thresholds
        print(f"[YOLO] Running detection on: {image_path}")
        print(f"[YOLO] Confidence threshold: {self.settings.yolo_confidence}")
        print(f"[YOLO] IoU threshold: {self.settings.yolo_iou}")
        print(f"[YOLO] Inference image size: {self.settings.yolo_imgsz}")
        print(f"[YOLO] Max detections: {self.settings.yolo_max_det}")
        print(f"[YOLO] Augment inference: {self.settings.yolo_augment}")
        
        results = model.predict(
            source=str(image_path),
            conf=self.settings.yolo_confidence,  # 0.25 - confidence threshold
            iou=self.settings.yolo_iou,          # 0.45 - NMS IoU threshold
            imgsz=self.settings.yolo_imgsz,
            max_det=self.settings.yolo_max_det,
            augment=self.settings.yolo_augment,
            verbose=False,
        )
        
        print(f"[YOLO] Results received: {len(results)} result(s)")
        
        if not results:
            print("[YOLO] No results returned from model")
            return []

        result = results[0]
        image_height, image_width = result.orig_shape
        image_area = float(max(image_width * image_height, 1))
        allowed_class_keyword = self.settings.yolo_allowed_class_keyword.strip().lower()
        class_filter_enabled = False
        if (
            allowed_class_keyword
            and isinstance(result.names, dict)
            and any(allowed_class_keyword in str(name).lower() for name in result.names.values())
        ):
            class_filter_enabled = True
        elif allowed_class_keyword:
            print(
                f"[YOLO] Class filter keyword '{allowed_class_keyword}' not found in model classes. "
                "Class filtering disabled."
            )
        
        print(f"[YOLO] Image size: {image_width}x{image_height}")

        # Check if we have segmentation masks
        masks = result.masks
        boxes = result.boxes
        
        if masks is None:
            print("[YOLO] No masks found - this is a detection model (not segmentation)")
            print("[YOLO] Will generate bounding boxes without masks")
        if boxes is None:
            print("[YOLO] No boxes found in result")
            return []
        
        # If no boxes at all, return empty
        if len(boxes) == 0:
            print("[YOLO] No leaf detections found")
            return []
        
        print(f"[YOLO] Found {len(boxes)} potential leaf detection(s)")

        detections: list[dict] = []
        for index, box in enumerate(boxes):
            # Get bounding box
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            confidence = float(box.conf[0].item()) if box.conf is not None else 0.0
            class_id = int(box.cls[0].item()) if box.cls is not None else None
            class_name = ""
            if class_id is not None:
                class_name = str(result.names.get(class_id, "")) if isinstance(result.names, dict) else ""

            width = max(x2 - x1, 0.0)
            height = max(y2 - y1, 0.0)
            box_area_ratio = (width * height) / image_area
            
            print(
                f"[YOLO] Detection #{index+1}: class={class_name or class_id}, "
                f"confidence={confidence:.4f}, box=({x1:.1f},{y1:.1f},{x2:.1f},{y2:.1f}), "
                f"size={width:.1f}x{height:.1f}, area_ratio={box_area_ratio:.4f}"
            )

            # Filter tiny detections
            if width < 8 or height < 8:
                print(f"[YOLO] Skipping detection #{index+1} - too small")
                continue
            if confidence < self.settings.yolo_min_result_confidence:
                print(
                    f"[YOLO] Skipping detection #{index+1} - confidence {confidence:.4f} "
                    f"< min_result_confidence {self.settings.yolo_min_result_confidence:.4f}"
                )
                continue
            if box_area_ratio < self.settings.yolo_min_box_area_ratio:
                print(
                    f"[YOLO] Skipping detection #{index+1} - area ratio {box_area_ratio:.4f} "
                    f"< min_box_area_ratio {self.settings.yolo_min_box_area_ratio:.4f}"
                )
                continue
            if class_filter_enabled and class_name and allowed_class_keyword not in class_name.lower():
                print(
                    f"[YOLO] Skipping detection #{index+1} - class '{class_name}' "
                    f"does not match keyword '{allowed_class_keyword}'"
                )
                continue

            # Generate contour from bounding box (for detection models without masks)
            if masks is None or not getattr(masks, "xy", None) or index >= len(masks.xy):
                # Create a simple rectangular contour from bounding box
                contour = [
                    {"x": round(x1, 2), "y": round(y1, 2)},
                    {"x": round(x2, 2), "y": round(y1, 2)},
                    {"x": round(x2, 2), "y": round(y2, 2)},
                    {"x": round(x1, 2), "y": round(y2, 2)},
                ]
                print(f"[YOLO] Using bounding box contour for detection #{index+1}")
            else:
                # Use polygon points already mapped to original image coordinates by Ultralytics.
                mask_polygon = masks.xy[index]
                contour = self._polygon_to_points(mask_polygon)
                if len(contour) < 3:
                    contour = [
                        {"x": round(x1, 2), "y": round(y1, 2)},
                        {"x": round(x2, 2), "y": round(y1, 2)},
                        {"x": round(x2, 2), "y": round(y2, 2)},
                        {"x": round(x1, 2), "y": round(y2, 2)},
                    ]

            detections.append(
                {
                    "leafId": f"leaf_{index + 1}",
                    "bbox_pixels": {
                        "x1": int(round(x1)),
                        "y1": int(round(y1)),
                        "x2": int(round(x2)),
                        "y2": int(round(y2)),
                    },
                    "bbox": {
                        "x": round(x1 / image_width, 6),
                        "y": round(y1 / image_height, 6),
                        "width": round(width / image_width, 6),
                        "height": round(height / image_height, 6),
                    },
                    "contour": contour,
                    "confidence": round(confidence, 4),
                }
            )
        if not detections and len(boxes) > 0:
            print("[YOLO] All detections filtered out; selecting best available box as fallback candidate")
            for index, box in enumerate(boxes):
                xyxy = box.xyxy[0].tolist()
                x1, y1, x2, y2 = xyxy
                confidence = float(box.conf[0].item()) if box.conf is not None else 0.0
                width = max(x2 - x1, 0.0)
                height = max(y2 - y1, 0.0)
                if width < 8 or height < 8:
                    continue
                box_area_ratio = (width * height) / image_area
                if box_area_ratio < 0.0005 or confidence < 0.05:
                    continue
                detections.append(
                    {
                        "leafId": f"leaf_{index + 1}",
                        "bbox_pixels": {
                            "x1": int(round(x1)),
                            "y1": int(round(y1)),
                            "x2": int(round(x2)),
                            "y2": int(round(y2)),
                        },
                        "bbox": {
                            "x": round(x1 / image_width, 6),
                            "y": round(y1 / image_height, 6),
                            "width": round(width / image_width, 6),
                            "height": round(height / image_height, 6),
                        },
                        "contour": [
                            {"x": round(x1, 2), "y": round(y1, 2)},
                            {"x": round(x2, 2), "y": round(y1, 2)},
                            {"x": round(x2, 2), "y": round(y2, 2)},
                            {"x": round(x1, 2), "y": round(y2, 2)},
                        ],
                        "confidence": round(confidence, 4),
                    }
                )
                break

        print(f"[YOLO] Final detections: {len(detections)}")
        return detections
