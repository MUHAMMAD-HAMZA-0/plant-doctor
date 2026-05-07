from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_vision_model: str = "gemini-2.5-flash"
    leaf_detector_model_path: str = "backend/app/models/leaf_detector.pt"
    yolo_confidence: float = 0.12
    yolo_iou: float = 0.5
    yolo_min_result_confidence: float = 0.06
    yolo_min_box_area_ratio: float = 0.0012
    yolo_allowed_class_keyword: str = ""
    yolo_imgsz: int = 1280
    yolo_max_det: int = 48
    yolo_augment: bool = False
    upload_dir: str = "backend/storage/uploads"

    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def upload_path(self) -> Path:
        return Path(self.upload_dir)

    @property
    def detector_model_path(self) -> Path:
        return Path(self.leaf_detector_model_path)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    return settings
