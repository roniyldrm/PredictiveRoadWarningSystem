"""ML model lifecycle + inference.

The trained artefact is ``data/road_risk_model.pkl`` — a joblib pickle of
``{"model": <sklearn estimator>, ...}``. Loading is O(hundreds of MB) so
it happens exactly once, during FastAPI startup.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib

from app.core.config import get_settings
from app.risk.schemas import RoadSurface, WeatherCondition

logger = logging.getLogger(__name__)


# Feature ordering MUST match what the model was trained on
# (see backend/scripts/preprocess_uk_accidents.py :: FEATURE_COLUMNS).
FEATURE_ORDER: tuple[str, ...] = (
    "latitude",
    "longitude",
    "h_loc_count",
    "hour",
    "day_of_week",
    "is_weekend",
    "is_night",
    "road_surface_encoded",
    "weather_risk_score",
    "is_raining",
    "is_high_wind",
    "is_fog",
)


# Mirrors preprocess_uk_accidents.ROAD_SURFACE_ENCODING.
_ROAD_SURFACE_CODE: Dict[RoadSurface, int] = {
    RoadSurface.dry: 0,
    RoadSurface.wet_or_damp: 1,
    RoadSurface.snow: 2,
    RoadSurface.frost_or_ice: 2,
    RoadSurface.flood_over_3cm: 3,
    RoadSurface.oil_or_diesel: 1,
    RoadSurface.mud: 1,
    RoadSurface.unknown: 0,
}


class RiskModel:
    """Thread-safe wrapper around the pickled sklearn estimator."""

    def __init__(self) -> None:
        self._model: Any = None
        self._metadata: Dict[str, Any] = {}
        self._path: Optional[Path] = None
        self._lock = threading.Lock()

    def load(self, path: Path) -> None:
        """Load the pickle from disk. Called once on startup."""
        if not path.exists():
            raise FileNotFoundError(
                f"Risk model artefact not found at {path}. "
                "Train and save it before starting the server."
            )
        logger.info("Loading risk model from %s ...", path)
        payload = joblib.load(path)
        if isinstance(payload, dict) and "model" in payload:
            self._model = payload["model"]
            self._metadata = {k: v for k, v in payload.items() if k != "model"}
        else:
            # Back-compat: bare estimator pickled directly.
            self._model = payload
            self._metadata = {}
        self._path = path
        logger.info(
            "Risk model ready (%s, metadata keys=%s)",
            type(self._model).__name__,
            sorted(self._metadata.keys()),
        )

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def metadata(self) -> Dict[str, Any]:
        return dict(self._metadata)

    def predict_score(self, features: Dict[str, float]) -> float:
        """Return a UK-style risk score in [0, 100] for a single example."""
        if self._model is None:
            raise RuntimeError("Risk model is not loaded yet.")
        vector: List[float] = [float(features[name]) for name in FEATURE_ORDER]
        with self._lock:
            # sklearn estimators aren't guaranteed thread-safe for predict;
            # the lock is cheap because inference is fast.
            raw = self._model.predict([vector])[0]
        return max(0.0, min(100.0, float(raw)))


# Module-level singleton consumed by the router.
risk_model = RiskModel()


# ---------------------- feature engineering helpers ----------------------

def _weekday_iso(now: datetime) -> int:
    """Python weekday() is 0=Mon..6=Sun; the dataset uses 1=Mon..7=Sun."""
    return now.isoweekday()


def build_feature_vector(
    latitude: float,
    longitude: float,
    h_loc_count: int,
    hour: Optional[int],
    day_of_week: Optional[int],
    road_surface: RoadSurface,
    weather_conditions: WeatherCondition,
    now: Optional[datetime] = None,
) -> Dict[str, float]:
    """Materialise the feature dict in the exact shape the model expects."""
    now = now or datetime.utcnow()
    h = hour if hour is not None else now.hour
    dow = day_of_week if day_of_week is not None else _weekday_iso(now)

    w = weather_conditions.value.lower()
    is_raining = int(("rain" in w) or ("wet" in w))
    is_high_wind = int("high wind" in w)
    is_fog = int(("fog" in w) or ("mist" in w))
    is_snow = int(("snow" in w) or ("frost" in w))
    weather_risk_score = min(3, is_raining + is_high_wind + is_fog + is_snow)

    return {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "h_loc_count": int(h_loc_count),
        "hour": int(h),
        "day_of_week": int(dow),
        "is_weekend": int(dow in (6, 7)),
        "is_night": int(h < 6 or h > 21),
        "road_surface_encoded": _ROAD_SURFACE_CODE.get(road_surface, 0),
        "weather_risk_score": weather_risk_score,
        "is_raining": is_raining,
        "is_high_wind": is_high_wind,
        "is_fog": is_fog,
    }


def band_for_score(score: float) -> str:
    if score < 25:
        return "low"
    if score < 50:
        return "moderate"
    if score < 75:
        return "high"
    return "severe"
