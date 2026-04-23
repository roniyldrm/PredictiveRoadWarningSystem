"""Idempotent index creation. Safe to call on every boot."""

from __future__ import annotations

import logging

from pymongo import ASCENDING, DESCENDING, GEOSPHERE

from app.db.client import (
    ACCIDENTS_COLLECTION,
    TRIPS_COLLECTION,
    USERS_COLLECTION,
    get_db,
)

logger = logging.getLogger(__name__)


async def ensure_indexes() -> None:
    db = get_db()

    await db[USERS_COLLECTION].create_index(
        [("email", ASCENDING)], unique=True, name="uniq_email"
    )

    # 2dsphere is required for $nearSphere proximity queries.
    await db[ACCIDENTS_COLLECTION].create_index(
        [("location", GEOSPHERE)], name="location_2dsphere"
    )
    await db[ACCIDENTS_COLLECTION].create_index(
        [("severity", ASCENDING)], name="severity_idx"
    )
    await db[ACCIDENTS_COLLECTION].create_index(
        [("weather_conditions", ASCENDING)], name="weather_idx"
    )
    await db[ACCIDENTS_COLLECTION].create_index(
        [("date", DESCENDING)], name="date_desc_idx"
    )

    await db[TRIPS_COLLECTION].create_index(
        [("user_id", ASCENDING), ("started_at", DESCENDING)],
        name="user_trips_recent",
    )

    logger.info("Indexes ensured (including 2dsphere on accident_history.location).")
