"""
Spectrum Allocation Engine — API endpoint v2
POST /api/allocate/analyze   → Full 3-phase analysis
POST /api/allocate/pre-screen → Phase 0 only (pre-scan)
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.models.fs_link import FSLink
from app.models.imt import IMTAllocation, SpectrumBlock
from app.services.interference import (
    InterferenceEngine, FSLinkData, IMTNeighborData,
)
from app.services.coverage import CoverageEngine

router = APIRouter()


@router.post("/analyze")
async def analyze_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Full 3-phase interference analysis for a proposed IMT allocation.

    Phase 0: Victim/Interferer Identification (pre-screen)
    Phase 1: Detailed I[dBm] calculation per pair
    Phase 2: Aggregate to 10 MHz block status

    Request body:
    {
        "center_lat": 13.75,
        "center_lon": 100.5,
        "cell_radius": 500,
        "antenna_height": 15,
        "antenna_gain": 12,
        "max_eirp": 23,
        "model": "free_space"  // optional
    }
    """
    center_lat = float(data["center_lat"])
    center_lon = float(data["center_lon"])
    cell_radius = float(data["cell_radius"])
    antenna_height = float(data["antenna_height"])
    antenna_gain = float(data.get("antenna_gain", 0))
    model_name = data.get("model", "free_space")
    
    # ── Coverage: auto-calculate EIRP if requested ──
    auto_eirp = data.get("auto_eirp", False)
    coverage_result = None
    
    if auto_eirp:
        # Use coverage engine to compute required EIRP from cell_radius
        cov_engine = CoverageEngine(propagation_model=model_name)
        coverage_result = cov_engine.calculate_required_eirp(
            cell_radius_m=cell_radius,
            bs_antenna_height_m=antenna_height,
            bs_antenna_gain_dbi=antenna_gain,
            target_rss_dbm=data.get("target_rss"),
            shadow_margin_db=data.get("shadow_margin"),
            building_loss_db=data.get("building_loss"),
            ue_antenna_gain_dbi=data.get("ue_antenna_gain"),
        )
        max_eirp = coverage_result.required_eirp_dbm
    else:
        max_eirp = float(data["max_eirp"])

    # Query active FS links
    fs_query = select(FSLink).where(FSLink.status == "active")
    fs_result = await db.execute(fs_query)
    fs_links_raw = fs_result.scalars().all()

    fs_links = [
        FSLinkData(
            id=str(fs.id),
            name=fs.name,
            tx_lat=fs.tx_lat, tx_lon=fs.tx_lon,
            tx_altitude=fs.tx_altitude or 0,
            rx_lat=fs.rx_lat, rx_lon=fs.rx_lon,
            rx_altitude=fs.rx_altitude or 0,
            freq_low=fs.freq_low, freq_high=fs.freq_high,
            bandwidth=fs.bandwidth,
            tx_power=fs.tx_power,
            tx_antenna_gain=fs.tx_antenna_gain,
            rx_antenna_gain=fs.rx_antenna_gain or 0,
            beamwidth_deg=float(getattr(fs, 'beamwidth_deg', 3.0) or 3.0),
        )
        for fs in fs_links_raw
    ]

    # Query active IMT allocations with their spectrum blocks
    imt_query = select(IMTAllocation).where(IMTAllocation.status == "active")
    imt_result = await db.execute(imt_query)
    imt_raw = imt_result.scalars().all()

    # Batch query all spectrum blocks for active IMTs
    imt_ids = [str(imt.id) for imt in imt_raw]
    blocks_by_imt = {}
    if imt_ids:
        block_query = select(SpectrumBlock).where(
            SpectrumBlock.allocation_id.in_(imt_ids)
        ).where(SpectrumBlock.status == "allocated")
        block_result = await db.execute(block_query)
        for block in block_result.scalars().all():
            aid = str(block.allocation_id)
            if aid not in blocks_by_imt:
                blocks_by_imt[aid] = []
            blocks_by_imt[aid].append(block)

    # Build neighbor IMT data — ONE entry per allocated block per neighbor
    # Now includes EIRP parameters for bidirectional analysis
    neighbor_imts = []
    for imt in imt_raw:
        imt_id = str(imt.id)
        blocks = blocks_by_imt.get(imt_id, [])

        center = _parse_wkt_center(imt.area_wkt)
        if center is None:
            continue

        if not blocks:
            continue

        for block in blocks:
            neighbor_imts.append(
                IMTNeighborData(
                    id=imt_id,
                    name=str(imt.name),
                    center_lat=center["lat"],
                    center_lon=center["lon"],
                    cell_radius=float(imt.cell_radius),
                    freq_low=float(block.freq_low),
                    freq_high=float(block.freq_high),
                    max_eirp=float(getattr(imt, 'max_eirp', 23) or 23),
                    antenna_gain=float(getattr(imt, 'antenna_gain', 12) or 12),
                    antenna_height=float(getattr(imt, 'antenna_height', 15) or 15),
                )
            )

    # Run 3-phase interference analysis
    engine = InterferenceEngine(propagation_model=model_name)
    result = engine.analyze(
        center_lat=center_lat,
        center_lon=center_lon,
        cell_radius=cell_radius,
        antenna_height=antenna_height,
        antenna_gain=antenna_gain,
        max_eirp=max_eirp,
        fs_links=fs_links,
        neighbor_imts=neighbor_imts,
    )

    return {
        # Phase 0: Identified pairs
        "pairs": [
            {
                "interferer_type": p.interferer_type,
                "interferer_id": p.interferer_id,
                "interferer_name": p.interferer_name,
                "victim_type": p.victim_type,
                "victim_id": p.victim_id,
                "victim_name": p.victim_name,
                "direction": p.direction,
                "freq_overlap_low": p.freq_overlap_low,
                "freq_overlap_high": p.freq_overlap_high,
                "distance_m": p.distance_m,
                "within_beam": p.within_beam,
                "estimated_i_dbm": round(p.estimated_i_dbm, 1),
                "preliminary_risk": p.preliminary_risk,
            }
            for p in result.pairs
        ],

        # Phase 1: Detailed calculations
        "pair_results": [
            {
                "direction": pr.pair.direction,
                "interferer": f"{pr.pair.interferer_name} ({pr.pair.interferer_type})",
                "victim": f"{pr.pair.victim_name} ({pr.pair.victim_type})",
                "i_dbm": round(pr.i_dbm, 1),
                "threshold_dbm": pr.threshold_dbm,
                "margin_db": round(pr.margin_db, 1),
                "path_loss_db": round(pr.path_loss_db, 1),
                "effective_distance_m": round(pr.effective_distance_m, 0),
                "verdict": pr.verdict,
                "detail": pr.detail,
            }
            for pr in result.pair_results
        ],

        # Phase 2: Block results
        "blocks": [
            {
                "freq_low": b.freq_low,
                "freq_high": b.freq_high,
                "status": b.status,
                "max_eirp": b.max_eirp,
                "reason": b.reason,
            }
            for b in result.blocks
        ],

        # Metadata
        "summary": result.summary,
        "verification": result.verification,
        "computation_time_ms": round(result.computation_time_ms, 1),
        "model_used": model_name,
        "neighbor_imts_checked": len(neighbor_imts),
        "fs_links_checked": len(fs_links),
        "coverage": ({
            "auto_eirp": auto_eirp,
            "used_eirp_dbm": round(max_eirp, 1) if max_eirp else None,
            "cell_edge_rss_dbm": round(coverage_result.cell_edge_rss_dbm, 1) if coverage_result else None,
            "required_eirp_dbm": round(coverage_result.required_eirp_dbm, 1) if coverage_result else None,
            "coverage_classification": coverage_result.coverage_classification if coverage_result else None,
            "target_rss_dbm": coverage_result.target_rss_dbm if coverage_result else None,
            "shadow_margin_db": coverage_result.shadow_margin_db if coverage_result else None,
        } if auto_eirp else None),
        
        # Trade-off suggestion (when conflicts exist + auto_eirp)
        "tradeoff": _compute_tradeoff(result, coverage_result, max_eirp, auto_eirp, model_name, antenna_height, antenna_gain),
    }


def _compute_tradeoff(result, coverage_result, max_eirp, auto_eirp, model_name, antenna_height, antenna_gain):
    """
    When conflicts exist and auto_eirp was used, suggest EIRP reduction
    that avoids conflicts while maximizing coverage radius.
    
    Power-based conflicts (IMT→FS, FS→IMT) can be resolved by reducing EIRP.
    Distance-based conflicts (IMT↔IMT co-channel) require relocation.
    """
    if not auto_eirp or not coverage_result:
        return None
    
    conflicts = [pr for pr in result.pair_results if pr.verdict == "CONFLICT"]
    if not conflicts:
        return None
    
    # Separate power-based and distance-based conflicts
    power_conflicts = [pr for pr in conflicts 
                       if pr.pair.direction in ("IMT→FS", "FS→IMT")]
    distance_conflicts = [pr for pr in conflicts 
                          if pr.pair.direction == "IMT↔IMT_COCHANNEL"]
    
    conflicting_names = list(set(
        pr.pair.victim_name if pr.pair.interferer_type == "NEW_IMT"
        else pr.pair.interferer_name
        for pr in conflicts
    ))
    
    # Find required EIRP reduction from power-based conflicts
    if power_conflicts:
        # Each conflict: I[dBm] exceeds threshold by margin_db
        # To avoid: reduce EIRP by (I - threshold) = margin_db
        max_margin = max(pr.margin_db for pr in power_conflicts)
        suggested_eirp = max_eirp - max_margin
        
        # Clamp to reasonable minimum (0 dBm)
        suggested_eirp = max(suggested_eirp, 0)
    else:
        # Only distance-based conflicts — EIRP reduction won't help
        suggested_eirp = max_eirp
    
    # Calculate achievable radius at suggested EIRP
    from app.services.coverage import CoverageEngine
    cov = CoverageEngine(propagation_model=model_name)
    suggested_radius = cov.calculate_achievable_radius(
        eirp_dbm=suggested_eirp,
        bs_antenna_height_m=antenna_height,
        bs_antenna_gain_dbi=antenna_gain,
        target_rss_dbm=coverage_result.target_rss_dbm,
        shadow_margin_db=coverage_result.shadow_margin_db,
        building_loss_db=coverage_result.building_loss_db,
        ue_antenna_gain_dbi=coverage_result.ue_antenna_gain_dbi,
    )
    
    original_radius = coverage_result.cell_radius_m
    reduction_pct = ((original_radius - suggested_radius) / original_radius * 100) if original_radius > 0 else 0
    
    # Build message
    if power_conflicts and distance_conflicts:
        message = (
            f"ลด EIRP จาก {max_eirp:.1f} → {suggested_eirp:.1f} dBm (แก้ power conflicts) "
            f"→ รัศมี {original_radius:.0f}m → {suggested_radius:.0f}m (ลดลง {reduction_pct:.0f}%) "
            f"⚠️ co-channel conflicts ยังคงอยู่ — ต้องย้ายตำแหน่ง"
        )
        resolution = "partial"
    elif power_conflicts:
        if reduction_pct < 5:
            message = (
                f"EIRP reduction {max_eirp:.1f} → {suggested_eirp:.1f} dBm "
                f"resolves conflicts with minimal coverage impact "
                f"(radius {original_radius:.0f}m → {suggested_radius:.0f}m, −{reduction_pct:.0f}%)"
            )
        else:
            message = (
                f"ลด EIRP จาก {max_eirp:.1f} → {suggested_eirp:.1f} dBm "
                f"→ รัศมี {original_radius:.0f}m → {suggested_radius:.0f}m (ลดลง {reduction_pct:.0f}%)"
            )
        resolution = "eirp_reduction"
    else:
        message = (
            f"⚠️ ทุก conflict เป็น distance-based (co-channel) — "
            f"การลด EIRP ไม่ช่วย ต้องย้ายตำแหน่ง"
        )
        resolution = "relocation_required"
    
    return {
        "resolution_type": resolution,
        "original_radius_m": round(original_radius, 0),
        "original_eirp_dbm": round(max_eirp, 1),
        "suggested_radius_m": round(suggested_radius, 0),
        "suggested_eirp_dbm": round(suggested_eirp, 1),
        "radius_reduction_pct": round(reduction_pct, 0),
        "conflicting_systems": conflicting_names,
        "message": message,
    }


@router.post("/pre-screen")
async def pre_screen(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Phase 0 only — victim/interferer identification without full calculation.
    Fast pre-scan to show which systems could interfere.
    """
    center_lat = float(data["center_lat"])
    center_lon = float(data["center_lon"])
    cell_radius = float(data["cell_radius"])
    antenna_height = float(data.get("antenna_height", 15))
    antenna_gain = float(data.get("antenna_gain", 0))
    max_eirp = float(data.get("max_eirp", 23))
    model_name = data.get("model", "free_space")

    # Query FS links (simplified — same as analyze)
    fs_query = select(FSLink).where(FSLink.status == "active")
    fs_result = await db.execute(fs_query)
    fs_links_raw = fs_result.scalars().all()

    fs_links = [
        FSLinkData(
            id=str(fs.id),
            name=fs.name,
            tx_lat=fs.tx_lat, tx_lon=fs.tx_lon,
            tx_altitude=fs.tx_altitude or 0,
            rx_lat=fs.rx_lat, rx_lon=fs.rx_lon,
            rx_altitude=fs.rx_altitude or 0,
            freq_low=fs.freq_low, freq_high=fs.freq_high,
            bandwidth=fs.bandwidth,
            tx_power=fs.tx_power,
            tx_antenna_gain=fs.tx_antenna_gain,
            rx_antenna_gain=fs.rx_antenna_gain or 0,
            beamwidth_deg=float(getattr(fs, 'beamwidth_deg', 3.0) or 3.0),
        )
        for fs in fs_links_raw
    ]

    # Query IMT neighbors (simplified)
    imt_query = select(IMTAllocation).where(IMTAllocation.status == "active")
    imt_result = await db.execute(imt_query)
    imt_raw = imt_result.scalars().all()

    imt_ids = [str(imt.id) for imt in imt_raw]
    blocks_by_imt = {}
    if imt_ids:
        block_query = select(SpectrumBlock).where(
            SpectrumBlock.allocation_id.in_(imt_ids)
        ).where(SpectrumBlock.status == "allocated")
        block_result = await db.execute(block_query)
        for block in block_result.scalars().all():
            aid = str(block.allocation_id)
            if aid not in blocks_by_imt:
                blocks_by_imt[aid] = []
            blocks_by_imt[aid].append(block)

    neighbor_imts = []
    for imt in imt_raw:
        imt_id = str(imt.id)
        blocks = blocks_by_imt.get(imt_id, [])
        center = _parse_wkt_center(imt.area_wkt)
        if center is None or not blocks:
            continue
        for block in blocks:
            neighbor_imts.append(
                IMTNeighborData(
                    id=imt_id,
                    name=str(imt.name),
                    center_lat=center["lat"],
                    center_lon=center["lon"],
                    cell_radius=float(imt.cell_radius),
                    freq_low=float(block.freq_low),
                    freq_high=float(block.freq_high),
                    max_eirp=float(getattr(imt, 'max_eirp', 23) or 23),
                    antenna_gain=float(getattr(imt, 'antenna_gain', 12) or 12),
                    antenna_height=float(getattr(imt, 'antenna_height', 15) or 15),
                )
            )

    engine = InterferenceEngine(propagation_model=model_name)
    pairs = engine.phase0_identify_pairs(
        center_lat=center_lat, center_lon=center_lon,
        cell_radius=cell_radius,
        antenna_height=antenna_height,
        antenna_gain=antenna_gain,
        max_eirp=max_eirp,
        fs_links=fs_links,
        neighbor_imts=neighbor_imts,
    )

    return {
        "pairs": [
            {
                "interferer_type": p.interferer_type,
                "interferer_name": p.interferer_name,
                "victim_type": p.victim_type,
                "victim_name": p.victim_name,
                "direction": p.direction,
                "freq_overlap_low": p.freq_overlap_low,
                "freq_overlap_high": p.freq_overlap_high,
                "distance_m": p.distance_m,
                "within_beam": p.within_beam,
                "estimated_i_dbm": round(p.estimated_i_dbm, 1),
                "preliminary_risk": p.preliminary_risk,
            }
            for p in pairs
        ],
        "summary": {
            "total_pairs": len(pairs),
            "high_risk": sum(1 for p in pairs if p.preliminary_risk == "HIGH"),
            "medium_risk": sum(1 for p in pairs if p.preliminary_risk == "MEDIUM"),
            "low_risk": sum(1 for p in pairs if p.preliminary_risk == "LOW"),
            "directions": {
                "IMT→FS": sum(1 for p in pairs if p.direction == "IMT→FS"),
                "FS→IMT": sum(1 for p in pairs if p.direction == "FS→IMT"),
                "IMT↔IMT_COCHANNEL": sum(1 for p in pairs if p.direction == "IMT↔IMT_COCHANNEL"),
                "IMT↔IMT_ADJACENT": sum(1 for p in pairs if p.direction == "IMT↔IMT_ADJACENT"),
            },
        },
    }


def _parse_wkt_center(wkt: str) -> dict | None:
    """Parse WKT POLYGON and return approximate center from first point."""
    try:
        inner = wkt.replace("POLYGON", "").replace("(", "").replace(")", "").strip()
        coords = [c.strip().split() for c in inner.split(",") if c.strip()]
        if coords:
            lons = [float(c[0]) for c in coords]
            lats = [float(c[1]) for c in coords]
            return {"lat": sum(lats) / len(lats), "lon": sum(lons) / len(lons)}
    except Exception:
        pass
    return None
