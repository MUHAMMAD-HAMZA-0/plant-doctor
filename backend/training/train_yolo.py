from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
DATASET_CONFIG = ROOT / "backend" / "training" / "data" / "leaf_dataset.yaml"
DEFAULT_MODEL = "yolov8n.pt"
PROJECT_DIR = ROOT / "backend" / "training" / "runs"
OUTPUT_NAME = "leaf_detector"


def main() -> None:
    if not DATASET_CONFIG.exists():
        raise FileNotFoundError(
            f"Dataset config not found at '{DATASET_CONFIG}'. "
            "Edit backend/training/data/leaf_dataset.yaml first."
        )

    model = YOLO(DEFAULT_MODEL)
    model.train(
        data=str(DATASET_CONFIG),
        epochs=100,
        imgsz=640,
        batch=8,
        project=str(PROJECT_DIR),
        name=OUTPUT_NAME,
        pretrained=True,
        device="cpu",
    )


if __name__ == "__main__":
    main()
