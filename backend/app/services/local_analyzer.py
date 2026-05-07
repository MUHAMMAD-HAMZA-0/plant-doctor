from pathlib import Path

import cv2
import numpy as np


class LocalLeafAnalyzer:
    def analyze_leaf(self, image_path: Path) -> dict:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Unable to read image '{image_path}'.")

        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

        green_mask = cv2.inRange(hsv, (30, 35, 35), (95, 255, 255))
        yellow_mask = cv2.inRange(hsv, (15, 45, 45), (35, 255, 255))
        brown_mask = cv2.inRange(hsv, (5, 40, 20), (20, 255, 200))

        colored_mask = cv2.bitwise_or(green_mask, cv2.bitwise_or(yellow_mask, brown_mask))
        leaf_pixels = int(np.count_nonzero(colored_mask))
        total_pixels = image.shape[0] * image.shape[1]
        denominator = max(leaf_pixels, total_pixels // 5, 1)

        green_ratio = float(np.count_nonzero(green_mask)) / denominator
        yellow_ratio = float(np.count_nonzero(yellow_mask)) / denominator
        brown_ratio = float(np.count_nonzero(brown_mask)) / denominator

        saturation = hsv[:, :, 1].astype(np.float32)
        value = hsv[:, :, 2].astype(np.float32)
        mean_saturation = float(np.mean(saturation)) / 255.0
        mean_value = float(np.mean(value)) / 255.0

        condition = "healthy"
        severity = "none"
        confidence = 0.62
        observations = ["Local heuristic analysis used because cloud analysis is unavailable."]
        recommendation = "Keep monitoring the plant under stable light and watering conditions."

        stress_ratio = max(yellow_ratio, brown_ratio)
        if brown_ratio >= 0.18:
            condition = "brown_spots"
            recommendation = "Trim badly affected tissue, avoid overhead watering, and inspect for fungal spread."
        elif yellow_ratio >= 0.22:
            condition = "yellowing"
            recommendation = "Check watering balance, drainage, and nutrient availability."
        elif mean_saturation < 0.22 or mean_value < 0.25:
            condition = "wilting"
            recommendation = "Review soil moisture, heat stress, and root health."

        if condition != "healthy":
            if stress_ratio >= 0.4:
                severity = "severe"
                confidence = 0.78
            elif stress_ratio >= 0.25:
                severity = "moderate"
                confidence = 0.71
            else:
                severity = "mild"
                confidence = 0.66

        if condition == "healthy":
            confidence = 0.64
            observations.append(
                f"Leaf appears mostly green with limited yellow/brown discoloration ({yellow_ratio + brown_ratio:.0%})."
            )
        elif condition == "yellowing":
            observations.append(f"Yellow tones are visible across roughly {yellow_ratio:.0%} of the detected region.")
        elif condition == "brown_spots":
            observations.append(f"Brown or dry-looking regions cover roughly {brown_ratio:.0%} of the detected region.")
        else:
            observations.append(
                f"Leaf shows low color intensity (saturation {mean_saturation:.0%}) or dim appearance consistent with stress."
            )

        return {
            "condition": condition,
            "severity": severity,
            "confidence": round(confidence, 2),
            "observations": observations,
            "recommendation": recommendation,
        }
