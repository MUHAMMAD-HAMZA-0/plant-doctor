from pydantic import BaseModel, Field


class PolygonPoint(BaseModel):
    """A single point in a polygon contour."""
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)


class LeafSegment(BaseModel):
    """Segmentation mask as a polygon contour in pixel coordinates."""
    contour: list[PolygonPoint]
    # Bounding box for quick reference (normalized 0-1)
    bbox: dict[str, float] | None = None


class LeafDetection(BaseModel):
    leafId: str
    # Support both legacy bbox and new segmentation
    bbox: dict[str, float] | None = None
    segmentation: LeafSegment
    confidence: float = Field(..., ge=0, le=1)
    cropPath: str


class LeafAnalysis(BaseModel):
    leafId: str
    condition: str
    severity: str
    confidence: float = Field(..., ge=0, le=1)
    observations: list[str] = Field(default_factory=list)
    recommendation: str | None = None


class PlantSummary(BaseModel):
    totalLeaves: int
    healthyLeaves: int
    affectedLeaves: int
    dominantIssue: str
    overallRisk: str
    note: str


class PlantAnalysisResponse(BaseModel):
    imageId: str
    detections: list[LeafDetection]
    analyses: list[LeafAnalysis]
    summary: PlantSummary
