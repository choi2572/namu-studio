"""Datetime helpers to avoid mixing offset-naive and offset-aware datetimes."""
from datetime import datetime
from typing import Optional


def run_duration_ms(
    started_at: Optional[datetime],
    finished_at: Optional[datetime],
) -> Optional[int]:
    """Return duration in milliseconds. Normalizes to naive UTC so aware/naive can be subtracted."""
    if not started_at or not finished_at:
        return None
    a = started_at.replace(tzinfo=None) if started_at.tzinfo else started_at
    b = finished_at.replace(tzinfo=None) if finished_at.tzinfo else finished_at
    return int((b - a).total_seconds() * 1000)
