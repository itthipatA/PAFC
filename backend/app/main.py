"""
FastAPI Application — PAFC Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api import fs_links, imt, allocation, propagation

settings = get_settings()

app = FastAPI(
    title="PAFC — Private Automated Frequency Coordinator",
    description="ระบบจัดสรรคลื่นความถี่ IMT Private Network 4800-4990 MHz",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(fs_links.router, prefix="/api/fs-links", tags=["FS Links"])
app.include_router(imt.router, prefix="/api/imt", tags=["IMT Allocations"])
app.include_router(allocation.router, prefix="/api/allocate", tags=["Allocation"])
app.include_router(propagation.router, prefix="/api/propagation", tags=["Propagation"])


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "version": "0.1.0",
        "band": f"{settings.band_start_mhz}-{settings.band_end_mhz} MHz",
        "block_size": f"{settings.block_size_mhz} MHz",
    }
