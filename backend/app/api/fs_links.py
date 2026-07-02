"""
FS Links — CRUD API
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
import csv
import io
from app.db.database import get_db
from app.models.fs_link import FSLink

router = APIRouter()


@router.get("/")
async def list_fs_links(
    status: str = "active",
    freq_min: float = None,
    freq_max: float = None,
    db: AsyncSession = Depends(get_db),
):
    """List all FS links, optional filter by status and frequency range."""
    query = select(FSLink).where(FSLink.status == status)
    if freq_min is not None:
        query = query.where(FSLink.freq_low >= freq_min)
    if freq_max is not None:
        query = query.where(FSLink.freq_high <= freq_max)

    result = await db.execute(query)
    links = result.scalars().all()
    return {"count": len(links), "links": [_fs_to_dict(l) for l in links]}


@router.get("/{link_id}")
async def get_fs_link(link_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single FS link by ID."""
    result = await db.execute(select(FSLink).where(FSLink.id == link_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="FS Link not found")
    return _fs_to_dict(link)


@router.post("/")
async def create_fs_link(data: dict, db: AsyncSession = Depends(get_db)):
    """Create a new FS link."""
    link = FSLink(**data)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _fs_to_dict(link)


@router.put("/{link_id}")
async def update_fs_link(link_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    """Update an FS link."""
    result = await db.execute(select(FSLink).where(FSLink.id == link_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="FS Link not found")

    for key, value in data.items():
        if hasattr(link, key) and key not in ("id", "created_at"):
            setattr(link, key, value)

    await db.commit()
    await db.refresh(link)
    return _fs_to_dict(link)


@router.delete("/{link_id}")
async def delete_fs_link(link_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete an FS link (set status=inactive)."""
    result = await db.execute(select(FSLink).where(FSLink.id == link_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="FS Link not found")

    link.status = "inactive"
    await db.commit()
    return {"message": f"FS Link {link_id} deactivated"}


@router.post("/import/csv")
async def import_fs_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Import FS links from CSV file."""
    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))

    created = 0
    errors = []
    for row in reader:
        try:
            link = FSLink(
                name=row["name"],
                operator=row["operator"],
                tx_lat=float(row["tx_lat"]),
                tx_lon=float(row["tx_lon"]),
                tx_altitude=float(row.get("tx_altitude") or 0),
                rx_lat=float(row["rx_lat"]),
                rx_lon=float(row["rx_lon"]),
                rx_altitude=float(row.get("rx_altitude") or 0),
                freq_low=float(row["freq_low"]),
                freq_high=float(row["freq_high"]),
                bandwidth=float(row["bandwidth"]),
                tx_power=float(row["tx_power"]),
                tx_antenna_gain=float(row["tx_antenna_gain"]),
                rx_antenna_gain=float(row.get("rx_antenna_gain") or 0),
                azimuth=float(row.get("azimuth") or 0),
                polarization=row.get("polarization", ""),
                channel_plan=row.get("channel_plan", ""),
            )
            db.add(link)
            created += 1
        except Exception as e:
            errors.append({"row": row.get("name", "unknown"), "error": str(e)})

    await db.commit()
    return {"imported": created, "errors": len(errors), "error_details": errors}


def _fs_to_dict(link: FSLink) -> dict:
    return {
        "id": str(link.id),
        "name": link.name,
        "operator": link.operator,
        "tx": {"lat": link.tx_lat, "lon": link.tx_lon, "altitude": link.tx_altitude},
        "rx": {"lat": link.rx_lat, "lon": link.rx_lon, "altitude": link.rx_altitude},
        "frequency": {"low": link.freq_low, "high": link.freq_high, "bandwidth": link.bandwidth},
        "rf": {
            "tx_power": link.tx_power,
            "tx_antenna_gain": link.tx_antenna_gain,
            "rx_antenna_gain": link.rx_antenna_gain,
            "azimuth": link.azimuth,
            "polarization": link.polarization,
        },
        "channel_plan": link.channel_plan,
        "status": link.status,
        "created_at": str(link.created_at),
    }
