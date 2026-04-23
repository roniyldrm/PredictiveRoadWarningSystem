"""Input / output models for risk prediction + accident data."""

from __future__ import annotations

from datetime import date as _date, time as _time
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.types import GeoPoint, PyObjectId


# ------------------------------ enums ----------------------------------

class Severity(str, Enum):
    fatal = "Fatal"
    serious = "Serious"
    slight = "Slight"


class RoadSurface(str, Enum):
    dry = "Dry"
    wet_or_damp = "Wet or damp"
    snow = "Snow"
    frost_or_ice = "Frost or ice"
    flood_over_3cm = "Flood over 3cm. deep"
    oil_or_diesel = "Oil or diesel"
    mud = "Mud"
    unknown = "Unknown"


class WeatherCondition(str, Enum):
    """Categorical weather values used in the UK dataset."""

    fine_no_high_winds = "Fine no high winds"
    raining_no_high_winds = "Raining no high winds"
    snowing_no_high_winds = "Snowing no high winds"
    fine_high_winds = "Fine + high winds"
    raining_high_winds = "Raining + high winds"
    snowing_high_winds = "Snowing + high winds"
    fog_or_mist = "Fog or mist"
    other = "Other"
    unknown = "Unknown"


# ---------------------- accident documents ------------------------------

class AccidentCreate(BaseModel):
    """Shape produced by the importer before persisting to Mongo."""

    severity: Severity
    date: _date
    day_of_week: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    road_surface: RoadSurface = RoadSurface.unknown
    time: Optional[_time] = None
    weather_conditions: WeatherCondition = WeatherCondition.unknown

    def to_document(self) -> dict:
        return {
            "severity": self.severity.value,
            "date": self.date.isoformat(),
            "day_of_week": self.day_of_week,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "road_surface": self.road_surface.value,
            "time": self.time.isoformat() if self.time else None,
            "weather_conditions": self.weather_conditions.value,
            "location": GeoPoint.from_lat_lon(
                self.latitude, self.longitude
            ).model_dump(),
        }


class AccidentPublic(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId = Field(alias="_id")
    severity: str
    date: str
    day_of_week: str
    latitude: float
    longitude: float
    road_surface: str
    time: Optional[str] = None
    weather_conditions: str


# ---------------------------- risk API ----------------------------------

class RiskRequest(BaseModel):
    """Input to POST /api/risk/predict.

    The client only has to supply the GPS fix + current conditions; missing
    temporal fields (hour, day_of_week) are derived from the server clock.
    """

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    day_of_week: Optional[int] = Field(
        default=None, ge=1, le=7, description="1=Monday .. 7=Sunday"
    )
    road_surface: RoadSurface = RoadSurface.unknown
    weather_conditions: WeatherCondition = WeatherCondition.unknown
    nearby_radius_m: float = Field(
        default=500.0,
        gt=0,
        le=5000,
        description="Radius used to compute h_loc_count from accident_history.",
    )


class RiskResponse(BaseModel):
    """Output of POST /api/risk/predict."""

    risk_score: float = Field(
        ge=0.0, le=100.0,
        description="Predicted UK Stats19-derived risk score (0 = safest, 100 = most dangerous).",
    )
    risk_band: str = Field(
        description="Discretised risk bucket: low / moderate / high / severe.",
    )
    h_loc_count: int = Field(
        description="Number of historical accidents within nearby_radius_m.",
    )
    features_used: dict = Field(description="Feature vector fed to the model.")


class AccidentsNearbyResponse(BaseModel):
    count: int
    results: List[AccidentPublic]


# --------------- real-time GPS-driven risk (OpenWeatherMap) ------------

class PredictRiskRequest(BaseModel):
    """GPS payload streamed by the mobile client."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    speed: Optional[float] = Field(
        default=None, ge=0, le=120,
        description="Vehicle speed in m/s. Not used by the model yet; kept for logging.",
    )
    heading: Optional[float] = Field(
        default=None, ge=0, le=360,
        description="Heading in degrees (0=N, 90=E). Kept for logging / trip trail.",
    )
    nearby_radius_m: float = Field(
        default=500.0,
        gt=0,
        le=5000,
        description="Radius used to compute h_loc_count from accident_history.",
    )


class RiskConditions(BaseModel):
    """Context the server used to compute the risk score — surfaced so the
    client can explain *why* the score is what it is (weather, accident
    history, etc.) without re-deriving it.
    """

    h_loc_count: int = Field(
        description="Historical accident count within nearby_radius_m.",
    )
    rain_mm: float = Field(description="Instantaneous rainfall (mm/h).")
    visibility_m: float = Field(description="Visibility in metres.")
    wind_speed: float = Field(description="Wind speed in m/s.")
    temperature: float = Field(description="Air temperature in °C.")


class PredictRiskResponse(BaseModel):
    """Output of POST /api/predict-risk."""

    risk_score: float = Field(
        ge=0.0, le=100.0,
        description="Blended R_total / ML risk score (0 = safest, 100 = most dangerous).",
    )
    risk_level: str = Field(description="Low | Medium | High.")
    alert_message: str = Field(
        description="Short human-readable description of the dominant hazards.",
    )
    conditions: Optional[RiskConditions] = Field(
        default=None,
        description="Weather + accident-density signals used for the score.",
    )
