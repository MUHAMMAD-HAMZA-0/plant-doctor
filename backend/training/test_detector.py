from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "backend" / "app" / "models" / "leaf_detector.pt"
TEST_IMAGE = ROOT / "backend" / "training" / "sample.jpg"
OUTPUT_DIR = ROOT / "backend" / "training" / "runs" / "predict"


def main() -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Detector model not found at '{MODEL_PATH}'. Export or copy the trained weights first."
        )
    if not TEST_IMAGE.exists():
        raise FileNotFoundError(
            f"Test image not found at '{TEST_IMAGE}'. Add a sample image before running."
        )

    model = YOLO(str(MODEL_PATH))
    model.predict(
        source=str(TEST_IMAGE),
        conf=0.25,
        save=True,
        project=str(OUTPUT_DIR),
        name="leaf_detector_preview",
        exist_ok=True,
    )
    print("Prediction preview saved under backend/training/runs/predict")


if __name__ == "__main__":
    main()
