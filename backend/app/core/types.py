"""Shared Pydantic building blocks reused across feature packages.

These are deliberately feature-agnostic (no auth/risk/history imports).
"""

from __future__ import annotations

from typing import Annotated, Any, List, Literal

from bson import ObjectId
from pydantic import BaseModel, Field, GetCoreSchemaHandler
from pydantic_core import core_schema


class _ObjectIdPydanticAnnotation:
    """Lets Pydantic v2 validate / serialize MongoDB ObjectIds."""

    @classmethod
    def __get_pydantic_core_schema__(
        cls, _source_type: Any, _handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        def validate(value: Any) -> ObjectId:
            if isinstance(value, ObjectId):
                return value
            if isinstance(value, str) and ObjectId.is_valid(value):
                return ObjectId(value)
            raise ValueError(f"Invalid ObjectId: {value!r}")

        return core_schema.no_info_plain_validator_function(
            validate,
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda v: str(v), return_schema=core_schema.str_schema()
            ),
        )


PyObjectId = Annotated[ObjectId, _ObjectIdPydanticAnnotation]


class GeoPoint(BaseModel):
    """GeoJSON Point: { type: "Point", coordinates: [lon, lat] }.

    MongoDB's 2dsphere index requires the [longitude, latitude] order.
    """

    type: Literal["Point"] = "Point"
    coordinates: Annotated[List[float], Field(min_length=2, max_length=2)]

    @classmethod
    def from_lat_lon(cls, latitude: float, longitude: float) -> "GeoPoint":
        return cls(coordinates=[longitude, latitude])

    @property
    def longitude(self) -> float:
        return self.coordinates[0]

    @property
    def latitude(self) -> float:
        return self.coordinates[1]
