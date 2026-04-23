"""Motor client lifecycle + collection name constants."""

from __future__ import annotations

import logging
from typing import Optional

from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)

from app.core.config import get_settings

logger = logging.getLogger(__name__)


USERS_COLLECTION = "users"
ACCIDENTS_COLLECTION = "accident_history"
TRIPS_COLLECTION = "trip_history"


class _MongoState:
    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None


_state = _MongoState()


async def connect_to_mongo() -> None:
    """Open a Motor client and verify connectivity by pinging admin."""
    settings = get_settings()
    logger.info("Connecting to MongoDB database '%s'...", settings.mongodb_db_name)

    _state.client = AsyncIOMotorClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=10_000,
        uuidRepresentation="standard",
    )
    _state.db = _state.client[settings.mongodb_db_name]

    await _state.client.admin.command("ping")
    logger.info("MongoDB connection established.")


async def close_mongo_connection() -> None:
    if _state.client is not None:
        _state.client.close()
        _state.client = None
        _state.db = None
        logger.info("MongoDB connection closed.")


def get_db() -> AsyncIOMotorDatabase:
    if _state.db is None:
        raise RuntimeError(
            "MongoDB is not connected. Did you forget to call connect_to_mongo()?"
        )
    return _state.db


def get_collection(name: str) -> AsyncIOMotorCollection:
    return get_db()[name]
