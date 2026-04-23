"""Async repository around the users collection."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId

from app.auth.schemas import RegisterRequest, UserInDB
from app.auth.security import hash_password
from app.db import USERS_COLLECTION, get_collection


async def get_by_email(email: str) -> Optional[UserInDB]:
    doc = await get_collection(USERS_COLLECTION).find_one({"email": email.lower()})
    return UserInDB(**doc) if doc else None


async def get_by_id(user_id: str | ObjectId) -> Optional[UserInDB]:
    oid = user_id if isinstance(user_id, ObjectId) else ObjectId(user_id)
    doc = await get_collection(USERS_COLLECTION).find_one({"_id": oid})
    return UserInDB(**doc) if doc else None


async def create(payload: RegisterRequest) -> UserInDB:
    now = datetime.now(timezone.utc)
    to_insert = {
        "email": payload.email.lower(),
        "hashed_password": hash_password(payload.password),
        "full_name": payload.full_name,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    # motor/pymongo's insert_one mutates `to_insert` in-place to add the
    # generated "_id" key, so we must NOT also pass _id explicitly below
    # (double kwarg error). We read it back from the mutated dict instead.
    await get_collection(USERS_COLLECTION).insert_one(to_insert)
    return UserInDB(**to_insert)
