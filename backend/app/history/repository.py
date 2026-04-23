"""Async CRUD around the trip_history collection."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId

from app.db import TRIPS_COLLECTION, get_collection
from app.history.schemas import TripCreate, TripInDB


async def create(user_id: ObjectId, payload: TripCreate) -> TripInDB:
    doc = payload.model_dump(mode="python")
    doc["user_id"] = user_id
    doc["created_at"] = datetime.now(timezone.utc)
    # motor/pymongo's insert_one mutates `doc` in-place to add the generated
    # "_id" key, so we must NOT also pass _id explicitly below.
    await get_collection(TRIPS_COLLECTION).insert_one(doc)
    return TripInDB(**doc)


async def list_for_user(
    user_id: ObjectId, limit: int = 50, skip: int = 0
) -> List[TripInDB]:
    cursor = (
        get_collection(TRIPS_COLLECTION)
        .find({"user_id": user_id})
        .sort("started_at", -1)
        .skip(skip)
        .limit(limit)
    )
    return [TripInDB(**doc) async for doc in cursor]


async def count_for_user(user_id: ObjectId) -> int:
    return await get_collection(TRIPS_COLLECTION).count_documents({"user_id": user_id})


async def get_by_id(trip_id: str | ObjectId) -> Optional[TripInDB]:
    oid = trip_id if isinstance(trip_id, ObjectId) else ObjectId(trip_id)
    doc = await get_collection(TRIPS_COLLECTION).find_one({"_id": oid})
    return TripInDB(**doc) if doc else None


async def delete_for_user(
    trip_id: str | ObjectId, user_id: ObjectId
) -> bool:
    oid = trip_id if isinstance(trip_id, ObjectId) else ObjectId(trip_id)
    result = await get_collection(TRIPS_COLLECTION).delete_one(
        {"_id": oid, "user_id": user_id}
    )
    return result.deleted_count == 1
