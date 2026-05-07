from collections import Counter

from app.schemas.analysis import LeafAnalysis, PlantSummary


def build_summary(analyses: list[LeafAnalysis]) -> PlantSummary:
    total = len(analyses)
    healthy = sum(1 for item in analyses if item.condition == "healthy")
    affected = total - healthy
    issue_counts = Counter(
        item.condition for item in analyses if item.condition and item.condition != "healthy"
    )
    dominant_issue = issue_counts.most_common(1)[0][0] if issue_counts else "healthy"

    if affected == 0:
        overall_risk = "low"
        note = "Visible detected leaves appear mostly healthy."
    elif affected <= max(total // 3, 1):
        overall_risk = "medium"
        note = "A smaller subset of detected leaves shows stress."
    else:
        overall_risk = "high"
        note = "Several detected leaves show visible stress and need attention."

    return PlantSummary(
        totalLeaves=total,
        healthyLeaves=healthy,
        affectedLeaves=affected,
        dominantIssue=dominant_issue,
        overallRisk=overall_risk,
        note=note,
    )
