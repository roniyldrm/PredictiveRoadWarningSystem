"""Authentication feature package: register, login, JWT, current-user DI."""

from app.auth.router import router

__all__ = ["router"]
