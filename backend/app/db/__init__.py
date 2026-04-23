"""MongoDB connection package (Motor async driver).

Public API used by every feature package. Import from ``app.db`` only:

    from app.db import get_collection, USERS_COLLECTION
"""

from app.db.client import (
    ACCIDENTS_COLLECTION,
    TRIPS_COLLECTION,
    USERS_COLLECTION,
    close_mongo_connection,
    connect_to_mongo,
    get_collection,
    get_db,
)
from app.db.indexes import ensure_indexes

__all__ = [
    "ACCIDENTS_COLLECTION",
    "TRIPS_COLLECTION",
    "USERS_COLLECTION",
    "close_mongo_connection",
    "connect_to_mongo",
    "ensure_indexes",
    "get_collection",
    "get_db",
]
