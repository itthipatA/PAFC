"""
Propagation Models — List available models
"""
from fastapi import APIRouter
from app.services.propagation import PropagationRegistry

router = APIRouter()


@router.get("/models")
async def list_models():
    """List all available propagation models."""
    return {
        "models": PropagationRegistry.list_models(),
        "default": "free_space",
    }
