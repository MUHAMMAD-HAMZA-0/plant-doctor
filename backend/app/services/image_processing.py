from pathlib import Path

import cv2
import numpy as np


def load_image(image_path: Path) -> np.ndarray:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Unable to read image '{image_path}'.")
    return image


def crop_detection(
    image: np.ndarray,
    bbox_pixels: dict[str, int],
    padding_ratio: float = 0.05,
) -> np.ndarray:
    height, width = image.shape[:2]
    x1 = bbox_pixels["x1"]
    y1 = bbox_pixels["y1"]
    x2 = bbox_pixels["x2"]
    y2 = bbox_pixels["y2"]
    pad_x = int((x2 - x1) * padding_ratio)
    pad_y = int((y2 - y1) * padding_ratio)

    left = max(x1 - pad_x, 0)
    top = max(y1 - pad_y, 0)
    right = min(x2 + pad_x, width)
    bottom = min(y2 + pad_y, height)
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        raise ValueError("Generated an empty crop for detection.")
    return crop


def crop_from_polygon(
    image: np.ndarray,
    contour: list[dict[str, float]],
    padding_ratio: float = 0.1,
) -> np.ndarray:
    """
    Crop an image based on a polygon contour with padding.
    
    Args:
        image: OpenCV image array (H, W, C)
        contour: List of {x, y} points defining the polygon
        padding_ratio: Amount of padding to add around the contour (0.1 = 10%)
    
    Returns:
        Cropped image containing the polygon region
    """
    height, width = image.shape[:2]
    
    # Convert contour to numpy array
    points = np.array([[p["x"], p["y"]] for p in contour], dtype=np.int32)
    
    # Get bounding box of the polygon
    x, y, w, h = cv2.boundingRect(points)
    
    # Add padding
    pad_x = int(w * padding_ratio)
    pad_y = int(h * padding_ratio)
    
    left = max(x - pad_x, 0)
    top = max(y - pad_y, 0)
    right = min(x + w + pad_x, width)
    bottom = min(y + h + pad_y, height)
    
    # Crop the region
    crop = image[top:bottom, left:right]
    
    if crop.size == 0:
        raise ValueError("Generated an empty crop for polygon detection.")
    
    return crop


def save_crop(crop: np.ndarray, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), crop):
        raise ValueError(f"Unable to save crop to '{destination}'.")
    return destination
