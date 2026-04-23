"""RoadSense R_total analytic formula over real-time inputs.

The training script (``scripts/train_road_risk_model.py``) defines:

    R_total = alpha * H_loc + beta * W_t + gamma * T_t           # each in [0, 1]
              alpha = 0.5, beta = 0.3, gamma = 0.2

That baseline is recomputed here so the live endpoint can blend it with
the ML prediction. The only difference from training is that the
environmental term ``W_t`` is driven by the *numeric* OpenWeatherMap
signals (rain mm, visibility m, wind m/s) instead of the categorical UK
Stats19 weather enum, which would be useless in the Gulf / EU / …
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict


# Weights — must stay in sync with scripts/train_road_risk_model.py
ALPHA = 0.5
BETA = 0.3
GAMMA = 0.2

# Reference caps for normalising real-time weather into [0, 1]. These were
# chosen to match the upper end of the "hazardous driving" range that the
# UK Stats19 training signals ``is_raining`` / ``is_high_wind`` / ``is_fog``
# flip on, so the analytic score lives on the same 0-100 scale as the
# model output.
HEAVY_RAIN_MM = 7.6          # NWS "heavy" rain threshold
GALE_WIND_M_S = 17.2         # Beaufort 8
LOW_VISIBILITY_M = 1_000.0   # < 1 km == fog band
MAX_VISIBILITY_M = 10_000.0  # OpenWeatherMap caps reporting here

# Temporal
MAX_HOUR = 23.0

# Risk bands requested by the product spec.
HIGH_THRESHOLD = 75.0
MEDIUM_THRESHOLD = 40.0


# ---------------------------------------------------------------------


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


@dataclass(frozen=True)
class RiskComponents:
    """Normalised [0, 1] sub-scores that feed R_total."""

    h_loc: float   # historical density
    w_t: float     # environmental (weather)
    t_t: float     # temporal

    def r_total(
        self,
        alpha: float = ALPHA,
        beta: float = BETA,
        gamma: float = GAMMA,
    ) -> float:
        """Return R_total on a 0-100 scale."""
        combined = alpha * self.h_loc + beta * self.w_t + gamma * self.t_t
        return round(_clip01(combined) * 100.0, 2)


def _h_loc_normalised(h_loc_count: int, reference_max: float) -> float:
    """Scale the accident count against the training reference max."""
    if reference_max <= 0:
        # Fallback: heuristically saturate at 20 accidents in 500 m.
        reference_max = 20.0
    return _clip01(float(h_loc_count) / reference_max)


def _weather_normalised(
    rain_mm: float, visibility_m: float, wind_speed: float
) -> float:
    """Map real-time weather into a [0, 1] hazard score."""
    rain_component = _clip01(rain_mm / HEAVY_RAIN_MM)
    wind_component = _clip01(wind_speed / GALE_WIND_M_S)
    # Visibility is inverted: 10 km == safe (0), <= 1 km == max hazard (1).
    visibility_range = max(1.0, MAX_VISIBILITY_M - LOW_VISIBILITY_M)
    visibility_component = _clip01(
        (MAX_VISIBILITY_M - max(visibility_m, LOW_VISIBILITY_M)) / visibility_range
    )
    # Average of the three sub-signals keeps the component in [0, 1].
    return (rain_component + wind_component + visibility_component) / 3.0


def _temporal_normalised(hour: int, is_night: int, is_weekend: int) -> float:
    hour_component = _clip01(float(hour) / MAX_HOUR)
    return (hour_component + float(is_night) + float(is_weekend)) / 3.0


def build_components(
    *,
    h_loc_count: int,
    rain_mm: float,
    visibility_m: float,
    wind_speed: float,
    hour: int,
    is_night: int,
    is_weekend: int,
    h_loc_reference_max: float,
) -> RiskComponents:
    return RiskComponents(
        h_loc=_h_loc_normalised(h_loc_count, h_loc_reference_max),
        w_t=_weather_normalised(rain_mm, visibility_m, wind_speed),
        t_t=_temporal_normalised(hour, is_night, is_weekend),
    )


# ---------------------------------------------------------------------
# Runtime feature vector (for the ML model) built from real-time inputs.
# ---------------------------------------------------------------------


def derive_feature_dict(
    *,
    latitude: float,
    longitude: float,
    h_loc_count: int,
    rain_mm: float,
    visibility_m: float,
    wind_speed: float,
    temperature: float,
    now: datetime | None = None,
) -> Dict[str, float]:
    """Produce the literal feature vector described in the spec:

        [latitude, longitude, h_loc_count, hour, day_of_week,
         is_weekend, is_night, rain_mm, visibility_m, wind_speed,
         temperature]

    Returned as a dict because the router also needs to translate it into
    the (slightly different) vector the pickled sklearn model expects.
    """
    now = now or datetime.utcnow()
    hour = now.hour
    # ISO weekday: 1=Mon .. 7=Sun, matches the training pipeline.
    day_of_week = now.isoweekday()
    is_weekend = int(day_of_week in (6, 7))
    is_night = int(hour < 6 or hour > 21)

    return {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "h_loc_count": int(h_loc_count),
        "hour": int(hour),
        "day_of_week": int(day_of_week),
        "is_weekend": is_weekend,
        "is_night": is_night,
        "rain_mm": float(rain_mm),
        "visibility_m": float(visibility_m),
        "wind_speed": float(wind_speed),
        "temperature": float(temperature),
    }


# ---------------------------------------------------------------------
# Risk band + alert message
# ---------------------------------------------------------------------


def classify_risk_level(score: float) -> str:
    """Map a 0-100 score onto the product spec buckets."""
    if score > HIGH_THRESHOLD:
        return "High"
    if score >= MEDIUM_THRESHOLD:
        return "Medium"
    return "Low"


def build_alert_message(
    *,
    risk_level: str,
    rain_mm: float,
    visibility_m: float,
    wind_speed: float,
    temperature: float,
    h_loc_count: int,
) -> str:
    """Generate a short human-readable hazard summary."""
    parts: list[str] = []

    if rain_mm >= HEAVY_RAIN_MM:
        parts.append("Heavy Rain")
    elif rain_mm >= 2.5:
        parts.append("Moderate Rain")
    elif rain_mm > 0.0:
        parts.append("Light Rain")

    if visibility_m < LOW_VISIBILITY_M:
        parts.append("Low Visibility")

    if wind_speed >= GALE_WIND_M_S:
        parts.append("Gale-Force Wind")
    elif wind_speed >= 10.8:  # Beaufort 6 — "strong breeze"
        parts.append("Strong Wind")

    if temperature <= 0.0 and rain_mm > 0.0:
        parts.append("Icy Roads")

    if h_loc_count >= 10:
        parts.append("High Accident Zone")
    elif h_loc_count >= 3:
        parts.append("Accident-Prone Area")

    if not parts:
        if risk_level == "High":
            return "High risk ahead — drive with caution"
        if risk_level == "Medium":
            return "Moderate risk — stay alert"
        return "Clear conditions — normal driving"

    return " - ".join(parts)
