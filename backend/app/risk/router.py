"""HTTP routes for /api/risk (predict + accident proximity)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.auth.deps import CurrentUser
from app.risk.accidents import (
    count_accidents_within_radius,
    find_accidents_within_radius,
)
from app.risk.model import band_for_score, build_feature_vector, risk_model
from app.risk.schemas import (
    AccidentPublic,
    AccidentsNearbyResponse,
    RiskRequest,
    RiskResponse,
)

router = APIRouter(prefix="/api/risk", tags=["risk"])


@router.post(
    "/predict",
    response_model=RiskResponse,
    summary="Predict an R_total-style risk score for the caller's current context",
)
async def predict_risk(payload: RiskRequest, _: CurrentUser) -> RiskResponse:
    if not risk_model.is_loaded:
        # The startup hook should have loaded it; if we get here the pickle
        # was missing or corrupt. 503 tells the client to retry later.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Risk model is not loaded on the server.",
        )

    h_loc_count = await count_accidents_within_radius(
        payload.latitude, payload.longitude, payload.nearby_radius_m
    )
    features = build_feature_vector(
        latitude=payload.latitude,
        longitude=payload.longitude,
        h_loc_count=h_loc_count,
        hour=payload.hour,
        day_of_week=payload.day_of_week,
        road_surface=payload.road_surface,
        weather_conditions=payload.weather_conditions,
    )
    score = risk_model.predict_score(features)
    return RiskResponse(
        risk_score=round(score, 2),
        risk_band=band_for_score(score),
        h_loc_count=h_loc_count,
        features_used=features,
    )


@router.get(
    "/accidents/nearby",
    response_model=AccidentsNearbyResponse,
    summary="List historical accidents around a point (2dsphere query)",
)
async def accidents_nearby(
    _: CurrentUser,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(500.0, gt=0, le=5000),
    limit: int = Query(100, ge=1, le=500),
) -> AccidentsNearbyResponse:
    docs = await find_accidents_within_radius(lat, lon, radius_m, limit)
    results = [AccidentPublic.model_validate(d) for d in docs]
    return AccidentsNearbyResponse(count=len(results), results=results)
