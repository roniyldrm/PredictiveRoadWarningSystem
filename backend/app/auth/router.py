"""HTTP routes for /api/auth."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.auth import repository as users_repo
from app.auth.deps import CurrentUser
from app.auth.schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)
from app.auth.security import create_access_token, verify_password
from app.core.config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_for(user_id: str, email: str) -> TokenResponse:
    settings = get_settings()
    access_token = create_access_token(subject=user_id, extra_claims={"email": email})
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.jwt_expire_minutes * 60,
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new user account",
)
async def register(payload: RegisterRequest) -> TokenResponse:
    # Cheap pre-check that skips a wasted bcrypt round on dupes.
    if await users_repo.get_by_email(payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )
    try:
        user = await users_repo.create(payload)
    except DuplicateKeyError:
        # Race between the pre-check and the insert - treat as conflict too.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    assert user.id is not None
    return _token_for(str(user.id), user.email)


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Exchange email + password for a signed JWT",
)
async def login(payload: LoginRequest) -> TokenResponse:
    user = await users_repo.get_by_email(payload.email)
    if user is None or not verify_password(payload.password, user.hashed_password):
        # Identical response for "no such user" vs "wrong password"
        # to avoid leaking which emails are registered.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is disabled.",
        )

    assert user.id is not None
    return _token_for(str(user.id), user.email)


@router.get("/me", response_model=UserPublic, summary="Return the caller's profile")
async def me(current_user: CurrentUser) -> UserPublic:
    return UserPublic.model_validate(current_user.model_dump(by_alias=True))
