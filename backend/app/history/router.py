"""HTTP routes for /api/history (trip history)."""

from __future__ import annotations

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from app.auth.deps import CurrentUser
from app.history import repository as trips_repo
from app.history.schemas import (
    TripCreate,
    TripListResponse,
    TripPublic,
)


router = APIRouter(prefix="/api/history", tags=["history"])


def _to_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid identifier.",
        )


def _to_public(trip_in_db) -> TripPublic:
    return TripPublic.model_validate(trip_in_db.model_dump(by_alias=True))


@router.get(
    "/trips",
    response_model=TripListResponse,
    summary="List the caller's past trips (most recent first)",
)
async def list_trips(
    user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
) -> TripListResponse:
    assert user.id is not None
    user_oid = user.id if isinstance(user.id, ObjectId) else ObjectId(str(user.id))

    trips = await trips_repo.list_for_user(user_oid, limit=limit, skip=skip)
    total = await trips_repo.count_for_user(user_oid)
    return TripListResponse(
        count=total,
        trips=[_to_public(t) for t in trips],
    )


@router.post(
    "/trips",
    response_model=TripPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Record a completed trip for the caller",
)
async def create_trip(payload: TripCreate, user: CurrentUser) -> TripPublic:
    if payload.ended_at < payload.started_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ended_at must be on or after started_at.",
        )
    assert user.id is not None
    user_oid = user.id if isinstance(user.id, ObjectId) else ObjectId(str(user.id))
    trip = await trips_repo.create(user_oid, payload)
    return _to_public(trip)


@router.get(
    "/trips/{trip_id}",
    response_model=TripPublic,
    summary="Fetch one of the caller's trips by id",
)
async def get_trip(
    user: CurrentUser,
    trip_id: str = Path(..., description="Trip ObjectId as a hex string."),
) -> TripPublic:
    oid = _to_object_id(trip_id)
    trip = await trips_repo.get_by_id(oid)
    if trip is None or trip.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found."
        )
    return _to_public(trip)


@router.delete(
    "/trips/{trip_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete one of the caller's trips",
)
async def delete_trip(
    user: CurrentUser,
    trip_id: str = Path(...),
) -> Response:
    oid = _to_object_id(trip_id)
    assert user.id is not None
    user_oid = user.id if isinstance(user.id, ObjectId) else ObjectId(str(user.id))
    deleted = await trips_repo.delete_for_user(oid, user_oid)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found."
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
