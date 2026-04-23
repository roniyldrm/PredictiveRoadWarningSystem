"""Application configuration loaded from environment / .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Mongo ---
    mongodb_uri: str = Field(..., alias="MONGODB_URI")
    mongodb_db_name: str = Field("roadsense", alias="MONGODB_DB_NAME")

    # --- JWT ---
    jwt_secret: str = Field("dev-secret-change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field("HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(1440, alias="JWT_EXPIRE_MINUTES")

    # --- CORS ---
    # Comma-separated list, e.g. "http://localhost:19006,https://app.example.com".
    # Use "*" to allow any origin (dev only).
    cors_allow_origins: str = Field("*", alias="CORS_ALLOW_ORIGINS")

    # --- Dataset import ---
    accidents_dataset_path: str = Field(
        "data/Accident_Information.csv.xlsx", alias="ACCIDENTS_DATASET_PATH"
    )
    import_accidents_on_startup: bool = Field(True, alias="IMPORT_ACCIDENTS_ON_STARTUP")
    accidents_import_batch_size: int = Field(5000, alias="ACCIDENTS_IMPORT_BATCH_SIZE")

    # --- ML model ---
    risk_model_path: str = Field("data/road_risk_model.pkl", alias="RISK_MODEL_PATH")

    # --- OpenWeatherMap (real-time weather for /api/predict-risk) ---
    openweathermap_api_key: str = Field("", alias="OPENWEATHERMAP_API_KEY")
    openweathermap_timeout_seconds: float = Field(
        4.0, alias="OPENWEATHERMAP_TIMEOUT_SECONDS", gt=0.0, le=30.0
    )
    # Rounding resolution for the weather cache key. 0.02° ≈ 2 km, which is
    # well inside the risk model's spatial sensitivity.
    weather_cache_resolution_deg: float = Field(
        0.02, alias="WEATHER_CACHE_RESOLUTION_DEG", gt=0.0, le=1.0
    )
    weather_cache_ttl_seconds: int = Field(
        300, alias="WEATHER_CACHE_TTL_SECONDS", ge=0, le=3600
    )

    # --- TLS / reverse proxy ---
    # When true, FastAPI trusts X-Forwarded-* headers (for running behind
    # an HTTPS-terminating reverse proxy such as nginx / traefik / ELB).
    trust_proxy_headers: bool = Field(True, alias="TRUST_PROXY_HEADERS")

    @property
    def dataset_absolute_path(self) -> Path:
        p = Path(self.accidents_dataset_path)
        return p if p.is_absolute() else (BACKEND_DIR / p)

    @property
    def model_absolute_path(self) -> Path:
        p = Path(self.risk_model_path)
        return p if p.is_absolute() else (BACKEND_DIR / p)

    @property
    def cors_origins_list(self) -> List[str]:
        raw = (self.cors_allow_origins or "").strip()
        if not raw or raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    @field_validator("jwt_secret")
    @classmethod
    def _warn_default_secret(cls, v: str) -> str:
        # Keep the default usable in dev but surface obvious mistakes.
        if not v or len(v) < 16:
            raise ValueError(
                "JWT_SECRET must be at least 16 characters. "
                "Set a long random value in the environment."
            )
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
