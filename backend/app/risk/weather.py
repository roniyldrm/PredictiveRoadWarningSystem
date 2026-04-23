"""Async OpenWeatherMap client for the real-time risk endpoint.

Only the fields the risk model actually consumes are parsed:

* ``rain_mm`` — last-hour rainfall in mm (``rain["1h"]`` when present,
  otherwise ``rain["3h"] / 3``, otherwise 0).
* ``visibility_m`` — meters; OpenWeatherMap caps at 10 000.
* ``wind_speed`` — meters per second.
* ``temperature`` — Celsius (we call the API with ``units=metric``).

A small in-process TTL cache deduplicates calls for nearby requests. This
matters because mobile clients poll every few seconds while driving and
OpenWeatherMap's free tier is rate-limited to 60 calls/min.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


OPENWEATHERMAP_URL = "https://api.openweathermap.org/data/2.5/weather"


class WeatherUnavailableError(RuntimeError):
    """Raised when real-time weather can't be obtained (bad key, timeout, …)."""


@dataclass(frozen=True)
class RealTimeWeather:
    """Normalised weather snapshot used by the risk pipeline."""

    rain_mm: float
    visibility_m: float
    wind_speed: float
    temperature: float
    description: str
    source: str  # "openweathermap" | "cache" | "fallback"
    fetched_at: float  # unix seconds

    def as_dict(self) -> Dict[str, Any]:
        return {
            "rain_mm": self.rain_mm,
            "visibility_m": self.visibility_m,
            "wind_speed": self.wind_speed,
            "temperature": self.temperature,
            "description": self.description,
            "source": self.source,
        }


# ------------------------------ parsing ------------------------------


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_owm_response(payload: Dict[str, Any]) -> RealTimeWeather:
    rain = payload.get("rain") or {}
    # Prefer the 1-hour accumulation; fall back to the 3-hour average if
    # that's all the station reports (happens with some METAR sources).
    if "1h" in rain:
        rain_mm = _coerce_float(rain.get("1h"))
    elif "3h" in rain:
        rain_mm = _coerce_float(rain.get("3h")) / 3.0
    else:
        rain_mm = 0.0

    # Some payloads include snow but not rain; treat it as liquid-equivalent
    # for the purposes of the risk score.
    snow = payload.get("snow") or {}
    if "1h" in snow:
        rain_mm = max(rain_mm, _coerce_float(snow.get("1h")))
    elif "3h" in snow:
        rain_mm = max(rain_mm, _coerce_float(snow.get("3h")) / 3.0)

    # `visibility` is documented as an integer in meters, max 10 000.
    visibility_m = _coerce_float(payload.get("visibility"), default=10_000.0)

    wind = payload.get("wind") or {}
    wind_speed = _coerce_float(wind.get("speed"))

    main = payload.get("main") or {}
    temperature = _coerce_float(main.get("temp"))

    description = ""
    weather_list = payload.get("weather") or []
    if weather_list:
        description = str(weather_list[0].get("description") or "").strip()

    return RealTimeWeather(
        rain_mm=max(0.0, rain_mm),
        visibility_m=max(0.0, visibility_m),
        wind_speed=max(0.0, wind_speed),
        temperature=temperature,
        description=description,
        source="openweathermap",
        fetched_at=time.time(),
    )


# ------------------------------ cache --------------------------------


class _WeatherCache:
    """Tiny async-safe TTL cache keyed by coarse (lat, lon)."""

    def __init__(self) -> None:
        self._entries: Dict[Tuple[float, float], RealTimeWeather] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _round(value: float, resolution: float) -> float:
        if resolution <= 0:
            return value
        return round(value / resolution) * resolution

    def _key(self, lat: float, lon: float, resolution: float) -> Tuple[float, float]:
        return (self._round(lat, resolution), self._round(lon, resolution))

    async def get(
        self, lat: float, lon: float, resolution: float, ttl: float
    ) -> Optional[RealTimeWeather]:
        if ttl <= 0:
            return None
        key = self._key(lat, lon, resolution)
        async with self._lock:
            entry = self._entries.get(key)
        if entry is None:
            return None
        if (time.time() - entry.fetched_at) > ttl:
            return None
        # Return a copy tagged as coming from the cache for observability.
        return RealTimeWeather(
            rain_mm=entry.rain_mm,
            visibility_m=entry.visibility_m,
            wind_speed=entry.wind_speed,
            temperature=entry.temperature,
            description=entry.description,
            source="cache",
            fetched_at=entry.fetched_at,
        )

    async def set(
        self, lat: float, lon: float, resolution: float, weather: RealTimeWeather
    ) -> None:
        key = self._key(lat, lon, resolution)
        async with self._lock:
            self._entries[key] = weather


_cache = _WeatherCache()


# ------------------------------ fetch --------------------------------


async def fetch_realtime_weather(
    latitude: float,
    longitude: float,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> RealTimeWeather:
    """Return real-time weather for (lat, lon) or raise ``WeatherUnavailableError``.

    The HTTP client is optional so the endpoint can inject a single shared
    instance; we create (and close) a throwaway client if none is given.
    """
    settings = get_settings()
    if not settings.openweathermap_api_key:
        raise WeatherUnavailableError(
            "OPENWEATHERMAP_API_KEY is not configured on the server."
        )

    cached = await _cache.get(
        latitude,
        longitude,
        resolution=settings.weather_cache_resolution_deg,
        ttl=float(settings.weather_cache_ttl_seconds),
    )
    if cached is not None:
        return cached

    params = {
        "lat": f"{latitude:.5f}",
        "lon": f"{longitude:.5f}",
        "units": "metric",
        "appid": settings.openweathermap_api_key,
    }
    timeout = httpx.Timeout(settings.openweathermap_timeout_seconds)

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout)
    try:
        try:
            response = await http.get(OPENWEATHERMAP_URL, params=params, timeout=timeout)
        except httpx.TimeoutException as exc:
            raise WeatherUnavailableError(
                f"Timed out contacting OpenWeatherMap: {exc}"
            ) from exc
        except httpx.HTTPError as exc:
            raise WeatherUnavailableError(
                f"Network error contacting OpenWeatherMap: {exc}"
            ) from exc

        if response.status_code == 401:
            raise WeatherUnavailableError(
                "OpenWeatherMap rejected the API key (401 Unauthorized)."
            )
        if response.status_code == 429:
            raise WeatherUnavailableError(
                "OpenWeatherMap rate limit reached (429 Too Many Requests)."
            )
        if response.status_code >= 400:
            raise WeatherUnavailableError(
                f"OpenWeatherMap returned HTTP {response.status_code}: "
                f"{response.text[:200]}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise WeatherUnavailableError(
                "OpenWeatherMap returned a non-JSON body."
            ) from exc
    finally:
        if owns_client:
            await http.aclose()

    weather = _parse_owm_response(payload)
    await _cache.set(
        latitude,
        longitude,
        resolution=settings.weather_cache_resolution_deg,
        weather=weather,
    )
    return weather
