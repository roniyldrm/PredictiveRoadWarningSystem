"""FastAPI application entrypoint.

Startup sequence (in order):
    1. Connect to MongoDB (Motor) and verify the link.
    2. Ensure indexes, including the 2dsphere on accident_history.location.
    3. Bulk-import the UK Road Safety dataset if the collection is empty.
    4. Load the trained risk model (road_risk_model.pkl) into memory once.

The app is HTTPS-ready: run behind an HTTPS-terminating reverse proxy
(nginx / traefik / ELB) and keep ``TRUST_PROXY_HEADERS=true`` so
``request.url`` reflects the real scheme via X-Forwarded-Proto.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.auth import router as auth_router
from app.core.config import get_settings
from app.db import (
    ACCIDENTS_COLLECTION,
    TRIPS_COLLECTION,
    USERS_COLLECTION,
    close_mongo_connection,
    connect_to_mongo,
    ensure_indexes,
    get_collection,
)
from app.history import router as history_router
from app.risk import realtime_router as risk_realtime_router
from app.risk import router as risk_router
from app.risk.accidents import import_accidents_if_empty
from app.risk.model import risk_model

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s :: %(message)s",
)
logger = logging.getLogger("roadsense")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()

    await connect_to_mongo()
    await ensure_indexes()
    await import_accidents_if_empty()

    try:
        risk_model.load(settings.model_absolute_path)
    except FileNotFoundError as exc:
        # Boot the API even without the pickle so auth / history still work.
        # /api/risk/predict will return 503 until the artefact is dropped in.
        logger.error("Risk model unavailable: %s", exc)

    yield

    await close_mongo_connection()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="RoadSense API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # --- CORS for the React Native client ---
    origins = settings.cors_origins_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # Minimal hardening for public deploys; "*" is a no-op safety net that
    # keeps the middleware in place so restricting hosts is a one-line change.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

    app.include_router(auth_router)
    app.include_router(risk_router)
    app.include_router(risk_realtime_router)
    app.include_router(history_router)

    @app.get("/health", tags=["system"])
    async def health() -> dict:
        return {
            "status": "ok",
            "db": settings.mongodb_db_name,
            "model_loaded": risk_model.is_loaded,
            "counts": {
                USERS_COLLECTION: await get_collection(
                    USERS_COLLECTION
                ).estimated_document_count(),
                ACCIDENTS_COLLECTION: await get_collection(
                    ACCIDENTS_COLLECTION
                ).estimated_document_count(),
                TRIPS_COLLECTION: await get_collection(
                    TRIPS_COLLECTION
                ).estimated_document_count(),
            },
        }

    return app


app = create_app()
