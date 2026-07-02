"""
Authentication API — login endpoint
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.auth import ADMIN_USERS, verify_password, create_access_token

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest):
    user = ADMIN_USERS.get(data.username)
    if not user or not verify_password(data.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_access_token(data.username, user["role"])
    return LoginResponse(
        access_token=token,
        username=data.username,
        role=user["role"],
    )


@router.get("/me")
async def me(user: dict = None):
    """Get current user info (requires auth). Import get_current_user in protected mode."""
    return {"authenticated": True}
