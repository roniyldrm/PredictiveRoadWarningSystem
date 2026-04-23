"""FastAPI dependencies for protected routes.

Usage:

    from app.auth.deps import CurrentUser

    @router.get("/me")
    async def me(user: CurrentUser) -> UserPublic: ...
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import repository as users_repo
from app.auth.schemas import UserInDB
from app.auth.security import JWTError, decode_access_token


# HTTPBearer matches our JSON login flow cleanly (no OAuth2 password form).
bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
) -> UserInDB:
    token = credentials.credentials
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise credentials_exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise credentials_exc

    user = await users_repo.get_by_id(user_id)
    if user is None or not user.is_active:
        raise credentials_exc
    return user


CurrentUser = Annotated[UserInDB, Depends(get_current_user)]
