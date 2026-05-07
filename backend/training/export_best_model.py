from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "backend" / "training" / "runs" / "leaf_detector" / "weights" / "best.pt"
DESTINATION = ROOT / "backend" / "app" / "models" / "leaf_detector.pt"


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(
            f"Best weights not found at '{SOURCE}'. Train the YOLO model first."
        )

    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE, DESTINATION)
    print(f"Copied model to: {DESTINATION}")


if __name__ == "__main__":
    main()
