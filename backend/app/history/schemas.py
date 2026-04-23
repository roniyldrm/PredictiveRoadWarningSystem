"""Trip history schemas."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.types import PyObjectId


class TripPoint(BaseModel):
    """A single GPS sample along a driving route."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timestamp: datetime
    speed_kmh: Optional[float] = None
    r_total: Optional[float] = Field(
        default=None,
        description="Instantaneous R_total risk score at this point (0-1).",
    )


class TripCreate(BaseModel):
    """What the client POSTs at the end of a trip."""

    started_at: datetime
    ended_at: datetime
    route: List[TripPoint] = Field(default_factory=list, max_length=20000)
    average_r_total: float = Field(ge=0.0, le=1.0)
    alert_count: int = Field(
        default=0,
        ge=0,
        description="Number of High-risk zones the driver entered during the trip.",
    )
    distance_km: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class TripInDB(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    user_id: PyObjectId
    started_at: datetime
    ended_at: datetime
    route: List[TripPoint]
    average_r_total: float
    alert_count: int = 0
    distance_km: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TripPublic(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId = Field(alias="_id")
    user_id: PyObjectId
    started_at: datetime
    ended_at: datetime
    route: List[TripPoint]
    average_r_total: float
    alert_count: int = 0
    distance_km: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime


class TripListResponse(BaseModel):
    count: int
    trips: List[TripPublic]
