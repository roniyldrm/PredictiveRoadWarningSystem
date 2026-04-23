"""Risk prediction feature package: ML inference + accident proximity queries."""

from app.risk.realtime import router as realtime_router
from app.risk.router import router

__all__ = ["router", "realtime_router"]
