"""POST /api/predict-risk — the real-time, GPS-driven risk endpoint.

Flow
----
1. The client POSTs ``{latitude, longitude, speed, heading}``.
2. We fire two coroutines concurrently via ``asyncio.gather``:
      - OpenWeatherMap: rain_mm, visibility_m, wind_speed, temperature
      - MongoDB 2dsphere query: number of historical accidents within 500 m
3. We build the 11-feature vector from the spec:
       [latitude, longitude, h_loc_count, hour, day_of_week,
        is_weekend, is_night, rain_mm, visibility_m, wind_speed, temperature]
4. Run inference on the pre-loaded ``road_risk_model.pkl`` and apply the
   analytic R_total = α·H_loc + β·W_t + γ·T_t formula (same α/β/γ as
   training). The published ``risk_score`` is the average of the two so
   a calibration issue on either side can't dominate.
5. Classify the score: >75 High, 40–75 Medium, <40 Low, and emit a short
   alert message describing the dominant hazards.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, status

from app.auth.deps import CurrentUser
from app.risk.accidents import count_accidents_within_radius
from app.risk.formula import (
    ALPHA,
    BETA,
    GAMMA,
    build_alert_message,
    build_components,
    classify_risk_level,
    derive_feature_dict,
)
from app.risk.model import FEATURE_ORDER, risk_model
from app.risk.schemas import PredictRiskRequest, PredictRiskResponse, RiskConditions
from app.risk.weather import (
    RealTimeWeather,
    WeatherUnavailableError,
    fetch_realtime_weather,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["risk"])


# ---------------------------------------------------------------------


def _feature_vector_for_model(
    realtime_features: Dict[str, float],
    weather: RealTimeWeather,
) -> List[float]:
    """Map the 11-feature real-time dict onto the 12-feature model input.

    The pickled sklearn estimator was trained on UK Stats19 categorical
    signals (``road_surface_encoded``, ``weather_risk_score``,
    ``is_raining``, ``is_high_wind``, ``is_fog``). We derive those from
    the numeric OpenWeatherMap readings so the same model can still be
    used in real time.
    """
    is_raining = int(weather.rain_mm > 0.0)
    # Beaufort 6 ("strong breeze") is the point where UK Stats19 flags
    # "high winds", so we use the same threshold here.
    is_high_wind = int(weather.wind_speed >= 10.8)
    is_fog = int(weather.visibility_m < 1_000.0)
    is_snow = int(weather.temperature <= 0.0 and weather.rain_mm > 0.0)
    weather_risk_score = min(3, is_raining + is_high_wind + is_fog + is_snow)
    # Road surface: wet when raining, otherwise unknown → 0.
    road_surface_encoded = 1 if is_raining else 0

    model_feature_map = {
        "latitude": realtime_features["latitude"],
        "longitude": realtime_features["longitude"],
        "h_loc_count": realtime_features["h_loc_count"],
        "hour": realtime_features["hour"],
        "day_of_week": realtime_features["day_of_week"],
        "is_weekend": realtime_features["is_weekend"],
        "is_night": realtime_features["is_night"],
        "road_surface_encoded": road_surface_encoded,
        "weather_risk_score": weather_risk_score,
        "is_raining": is_raining,
        "is_high_wind": is_high_wind,
        "is_fog": is_fog,
    }
    return [float(model_feature_map[name]) for name in FEATURE_ORDER]


async def _count_accidents_or_zero(
    latitude: float, longitude: float, radius_m: float
) -> int:
    """Proximity query that never raises — the endpoint must stay live."""
    try:
        return await count_accidents_within_radius(latitude, longitude, radius_m)
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("accident proximity query failed: %s", exc)
        return 0


# ---------------------------------------------------------------------


@router.post(
    "/api/predict-risk",
    response_model=PredictRiskResponse,
    summary="Real-time risk score from GPS + OpenWeatherMap + accident density",
)
async def predict_risk(
    payload: PredictRiskRequest,
    _: CurrentUser,
) -> PredictRiskResponse:
    if not risk_model.is_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Risk model is not loaded on the server.",
        )

    # ---- 1. Fire weather + accident density in parallel ------------------
    weather_task = asyncio.create_task(
        fetch_realtime_weather(payload.latitude, payload.longitude)
    )
    accidents_task = asyncio.create_task(
        _count_accidents_or_zero(
            payload.latitude, payload.longitude, payload.nearby_radius_m
        )
    )
    weather_result, h_loc_count = await asyncio.gather(
        weather_task, accidents_task, return_exceptions=True
    )

    if isinstance(weather_result, WeatherUnavailableError):
        # Real-time weather is load-bearing for this endpoint; tell the
        # client to retry rather than silently returning a stale score.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Weather provider unavailable: {weather_result}",
        )
    if isinstance(weather_result, BaseException):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected weather provider error.",
        ) from weather_result

    weather: RealTimeWeather = weather_result
    if isinstance(h_loc_count, BaseException):
        h_loc_count = 0
    h_loc_count = int(h_loc_count)

    # ---- 2. Build the 11-feature vector from the spec --------------------
    features = derive_feature_dict(
        latitude=payload.latitude,
        longitude=payload.longitude,
        h_loc_count=h_loc_count,
        rain_mm=weather.rain_mm,
        visibility_m=weather.visibility_m,
        wind_speed=weather.wind_speed,
        temperature=weather.temperature,
    )

    # ---- 3. ML inference on the pre-loaded pickle ------------------------
    model_vector = _feature_vector_for_model(features, weather)
    # risk_model.predict_score is keyed by feature name; call the raw
    # estimator instead because we already have the vector in FEATURE_ORDER.
    ml_score = risk_model.predict_score(
        dict(zip(FEATURE_ORDER, model_vector))
    )

    # ---- 4. Analytic R_total = α·H_loc + β·W_t + γ·T_t -------------------
    h_loc_reference_max = float(
        risk_model.metadata.get("h_loc_reference_max") or 0.0
    )
    components = build_components(
        h_loc_count=h_loc_count,
        rain_mm=weather.rain_mm,
        visibility_m=weather.visibility_m,
        wind_speed=weather.wind_speed,
        hour=features["hour"],
        is_night=features["is_night"],
        is_weekend=features["is_weekend"],
        h_loc_reference_max=h_loc_reference_max,
    )
    weights = _resolve_weights(risk_model.metadata)
    r_total = components.r_total(**weights)

    # ---- 5. Blend, classify, describe ------------------------------------
    blended_score = round((ml_score + r_total) / 2.0, 2)
    blended_score = max(0.0, min(100.0, blended_score))
    risk_level = classify_risk_level(blended_score)
    alert_message = build_alert_message(
        risk_level=risk_level,
        rain_mm=weather.rain_mm,
        visibility_m=weather.visibility_m,
        wind_speed=weather.wind_speed,
        temperature=weather.temperature,
        h_loc_count=h_loc_count,
    )

    logger.info(
        "predict-risk lat=%.5f lon=%.5f speed=%s heading=%s "
        "h_loc=%d rain=%.2fmm vis=%.0fm wind=%.2fm/s temp=%.1fC "
        "ml=%.2f r_total=%.2f -> %.2f (%s)",
        payload.latitude, payload.longitude, payload.speed, payload.heading,
        h_loc_count, weather.rain_mm, weather.visibility_m,
        weather.wind_speed, weather.temperature,
        ml_score, r_total, blended_score, risk_level,
    )

    return PredictRiskResponse(
        risk_score=blended_score,
        risk_level=risk_level,
        alert_message=alert_message,
        conditions=RiskConditions(
            h_loc_count=h_loc_count,
            rain_mm=round(weather.rain_mm, 2),
            visibility_m=round(weather.visibility_m, 0),
            wind_speed=round(weather.wind_speed, 2),
            temperature=round(weather.temperature, 1),
        ),
    )


def _resolve_weights(metadata: Dict[str, Any]) -> Dict[str, float]:
    """Prefer the α/β/γ saved in the model pickle; fall back to defaults."""
    raw = metadata.get("roadsense_weights") if isinstance(metadata, dict) else None
    if not isinstance(raw, dict):
        return {"alpha": ALPHA, "beta": BETA, "gamma": GAMMA}
    try:
        return {
            "alpha": float(raw.get("alpha", ALPHA)),
            "beta": float(raw.get("beta", BETA)),
            "gamma": float(raw.get("gamma", GAMMA)),
        }
    except (TypeError, ValueError):
        return {"alpha": ALPHA, "beta": BETA, "gamma": GAMMA}
