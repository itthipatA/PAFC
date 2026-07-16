"""
PAFC Allocation Engine — Phase 37

Replaces Phase 36's simple channel availability checker with proper
engineering-grounded allocation rules:

Rule 1: No IMT on same channel as FS within FS station's -120dBm radius
Rule 2: No IMT on same channel within 100m of another IMT's polygon boundary
Rule 3: Adjacent IMTs with different frame structures need guard band

Also generates a narrative log of all checks performed.
"""

import math
import json
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field

from app.services.fs_coverage import (
    compute_all_fs_coverages,
    RX_THRESHOLD_DBM,
    fs_station_coverage_circle_fallback,
)
from app.services.imt_buffer import (
    compute_imt_buffer_polygon,
    parse_polygon_coords,
    does_imt_buffer_intersect_fs_coverage,
    _point_in_polygon_fast,
)
from app.services.frame_structure import (
    check_frame_compatibility,
    determine_guard_blocks,
    get_frame_structure_options,
)


# ── Constants ────────────────────────────────────────────────────────────

BAND_START_MHZ = 4800
BAND_END_MHZ = 4990
BLOCK_WIDTH_MHZ = 10
NUM_BLOCKS = 19

IMT_BUFFER_M = 100.0  # IMT adjacency buffer


# ── Dataclasses ───────────────────────────────────────────────────────────

@dataclass
class AllocationBlock:
    """One 10 MHz block status in the allocation result."""
    freq_low: float
    freq_high: float
    index: int  # 0-18
    status: str  # "available" | "blocked_by_fs" | "blocked_by_imt"
    blocked_by: List[str] = field(default_factory=list)
    reason_th: str = ""
    # Guard band info
    can_be_guard: bool = False
    guard_reason_th: str = ""


@dataclass
class AllocationResult:
    """Full allocation check result."""
    blocks: List[AllocationBlock]
    narrative_log: List[str] = field(default_factory=list)
    polygon_area_km2: float = 0.0
    existing_imt_count: int = 0
    existing_fs_count: int = 0
    selected_frame_structure: str = ""
    summary: str = ""


# ── Main Engine ──────────────────────────────────────────────────────────

class AllocationEngine:
    """
    Phase 37 allocation engine.
    
    Usage:
        engine = AllocationEngine(db_session)
        result = await engine.analyze(
            polygon_geojson=...,
            frame_structure="DDDSU",
            operator="บริษัท A",
            name="โรงงาน X",
        )
    """
    
    def __init__(self, db_session):
        self.db = db_session
    
    async def analyze(
        self,
        polygon_geojson,
        frame_structure: str = "DDDSU",
        operator: str = "",
        name: str = "",
    ) -> AllocationResult:
        """
        Run full allocation analysis.
        
        Args:
            polygon_geojson: GeoJSON polygon of proposed IMT area
            frame_structure: TDD frame configuration
            operator: operator name
            name: site name
        
        Returns:
            AllocationResult with per-block status + narrative log
        """
        from sqlalchemy import select
        from app.models.fs_link import FSLink
        from app.models.imt import IMTAllocation, SpectrumBlock
        
        log: List[str] = []
        log.append("=" * 60)
        log.append("PAFC Allocation Engine — Phase 37")
        log.append(f"ชื่อสถานี: {name} | ผู้ให้บริการ: {operator}")
        log.append(f"รูปแบบ TDD: {frame_structure}")
        log.append(f"เกณฑ์การตรวจสอบ: FS -120dBm, IMT 100m buffer, Frame Structure")
        log.append("=" * 60)
        
        # ── Parse polygon ──
        try:
            coords = parse_polygon_coords(polygon_geojson)
        except Exception as e:
            log.append(f"❌ ไม่สามารถอ่านข้อมูล Polygon: {e}")
            return AllocationResult(
                blocks=[], narrative_log=log, summary=f"ข้อผิดพลาด: {e}"
            )
        
        log.append(f"📐 พื้นที่ Polygon: {len(coords)} จุด")
        
        # ── Compute IMT buffer (100m) ──
        try:
            imt_buffer = compute_imt_buffer_polygon(polygon_geojson, buffer_m=IMT_BUFFER_M)
            log.append(f"🟢 IMT Buffer: +{IMT_BUFFER_M}m จากขอบพื้นที่")
        except Exception as e:
            log.append(f"⚠️ ไม่สามารถคำนวณ Buffer: {e} — ใช้พื้นที่เดิม")
            imt_buffer = polygon_geojson if isinstance(polygon_geojson, dict) else json.loads(polygon_geojson)
        
        # ── Query active FS links ──
        fs_query = select(FSLink).where(
            FSLink.status == "active",
            FSLink.freq_high > BAND_START_MHZ,
            FSLink.freq_low < BAND_END_MHZ,
        )
        fs_result = await self.db.execute(fs_query)
        fs_links = fs_result.scalars().all()
        log.append(f"📡 FS Links ในย่าน 4800-4990 MHz: {len(fs_links)} เส้น")
        
        # Compute all FS coverages
        fs_coverages = compute_all_fs_coverages(fs_links, target_rx_dbm=RX_THRESHOLD_DBM)
        for fid, fc in fs_coverages.items():
            log.append(f"  └─ {fc['name']} ({fc['operator']}): "
                      f"max distance = {fc['max_distance_km']} km, "
                      f"freq = {fc['freq_low']}-{fc['freq_high']} MHz")
        
        # ── Query active IMT allocations ──
        imt_query = select(IMTAllocation).where(
            IMTAllocation.status.in_(["active", "pending"])
        )
        imt_result = await self.db.execute(imt_query)
        imt_allocations = imt_result.scalars().all()
        log.append(f"📶 IMT สถานีในระบบ: {len(imt_allocations)} สถานี")
        
        # ── Initialize blocks ──
        blocks = []
        for i in range(NUM_BLOCKS):
            flo = BAND_START_MHZ + i * BLOCK_WIDTH_MHZ
            fhi = flo + BLOCK_WIDTH_MHZ
            blocks.append(AllocationBlock(
                freq_low=flo,
                freq_high=fhi,
                index=i,
                status="available",
                reason_th=f"ว่าง ({flo}-{fhi} MHz)",
            ))
        
        log.append("")
        log.append("── เริ่มตรวจสอบทีละ Block ──")
        
        # ── Check each block ──
        for block in blocks:
            block_f_low = block.freq_low
            block_f_high = block.freq_high
            
            # ═══ RULE 1: FS -120dBm Check ═══
            for fs in fs_links:
                fs_f_low = fs.freq_low
                fs_f_high = fs.freq_high
                
                # Frequency overlap?
                if not (block_f_low < fs_f_high and fs_f_low < block_f_high):
                    continue
                
                fid = str(fs.id)
                if fid not in fs_coverages:
                    continue
                
                fc = fs_coverages[fid]
                
                # Check: does IMT buffer intersect FS TX coverage?
                if does_imt_buffer_intersect_fs_coverage(
                    imt_buffer, fc["tx_coverage"]
                ):
                    block.status = "blocked_by_fs"
                    block.blocked_by.append(f"FS TX: {fs.name} ({fs.operator})")
                    block.reason_th = (
                        f"❌ ไม่สามารถจัดสรร — FS {fs.name} ({fs.operator}) "
                        f"ส่งสัญญาณในความถี่ {fs_f_low}-{fs_f_high} MHz "
                        f"ที่ระยะ {fc['max_distance_km']} km (ถึง -120dBm) "
                        f"— ทับซ้อนกับพื้นที่ IMT"
                    )
                    log.append(
                        f"  บล็อก {block_f_low}-{block_f_high}: "
                        f"❌ ติด FS {fs.name} — TX coverage ทับซ้อน"
                    )
                    break  # No need to check more FS for this block
                
                # Check: does IMT buffer intersect FS RX coverage?
                if does_imt_buffer_intersect_fs_coverage(
                    imt_buffer, fc["rx_coverage"]
                ):
                    block.status = "blocked_by_fs"
                    block.blocked_by.append(f"FS RX: {fs.name} ({fs.operator})")
                    block.reason_th = (
                        f"❌ ไม่สามารถจัดสรร — FS {fs.name} ({fs.operator}) "
                        f"เครื่องรับอยู่ในพื้นที่ -120dBm ของ IMT "
                        f"ความถี่ {fs_f_low}-{fs_f_high} MHz"
                    )
                    log.append(
                        f"  บล็อก {block_f_low}-{block_f_high}: "
                        f"❌ ติด FS {fs.name} — RX ในพื้นที่ IMT"
                    )
                    break
            
            # ═══ RULE 2: IMT Adjacency (100m buffer) ═══
            if block.status == "available":
                for imt in imt_allocations:
                    # Get this IMT's blocks
                    sb_query = select(SpectrumBlock).where(
                        SpectrumBlock.allocation_id == imt.id,
                        SpectrumBlock.freq_high > block_f_low,
                        SpectrumBlock.freq_low < block_f_high,
                    )
                    sb_result = await self.db.execute(sb_query)
                    imt_blocks = sb_result.scalars().all()
                    
                    if not imt_blocks:
                        continue  # No frequency conflict
                    
                    # Get this IMT's buffer polygon
                    imt_buf = None
                    if imt.polygon_geojson:
                        try:
                            imt_buf = compute_imt_buffer_polygon(
                                imt.polygon_geojson, buffer_m=IMT_BUFFER_M
                            )
                        except Exception:
                            pass
                    
                    if imt_buf is None:
                        continue
                    
                    # Check buffer intersection
                    if does_imt_buffer_intersect_fs_coverage(imt_buffer, imt_buf):
                        block.status = "blocked_by_imt"
                        block.blocked_by.append(f"IMT: {imt.name} ({imt.operator})")
                        block.reason_th = (
                            f"❌ ไม่สามารถจัดสรร — IMT {imt.name} ({imt.operator}) "
                            f"ใช้คลื่น {block_f_low}-{block_f_high} MHz "
                            f"ในพื้นที่ใกล้เคียง (Buffer 100m ทับซ้อน)"
                        )
                        log.append(
                            f"  บล็อก {block_f_low}-{block_f_high}: "
                            f"❌ ติด IMT {imt.name} — Buffer 100m ทับซ้อน"
                        )
                        break
        
        # ═══ RULE 3: Frame Structure Guard Band ═══
        log.append("")
        log.append("── ตรวจสอบ Frame Structure ──")
        log.append(f"  รูปแบบที่เสนอ: {frame_structure}")
        
        # Check against all adjacent IMTs
        guard_blocks_needed = set()
        for imt in imt_allocations:
            imt_frame = getattr(imt, 'frame_structure', None)
            if not imt_frame:
                continue
            
            # Check if IMTs are adjacent (buffer overlap)
            imt_buf = None
            if imt.polygon_geojson:
                try:
                    imt_buf = compute_imt_buffer_polygon(
                        imt.polygon_geojson, buffer_m=IMT_BUFFER_M
                    )
                except Exception:
                    pass
            
            if imt_buf is None:
                continue
            
            if not does_imt_buffer_intersect_fs_coverage(imt_buffer, imt_buf):
                continue  # Not adjacent — skip frame comparison
            
            # Compare frame structures
            compat = check_frame_compatibility(frame_structure, imt_frame)
            log.append(
                f"  เทียบกับ {imt.name} ({imt_frame}): "
                f"{'✅ เข้ากันได้' if compat.compatible else '⚠️ ต้องใช้ย่านป้องกัน'}"
            )
            
            if compat.need_guard_band:
                # Mark edge blocks as guard candidates
                num_guard = compat.guard_band_width_khz // (BLOCK_WIDTH_MHZ * 1000)
                num_guard = max(1, num_guard)
                
                for i in range(min(num_guard, len(blocks))):
                    guard_blocks_needed.add(blocks[i].index)
                    if not blocks[i].can_be_guard:
                        blocks[i].can_be_guard = True
                        blocks[i].guard_reason_th = (
                            f"แนะนำย่านป้องกัน {compat.guard_band_width_khz/1000:.0f} MHz "
                            f"— {imt.name} ใช้รูปแบบ {imt_frame}"
                        )
        
        # ── Summary ──
        available = sum(1 for b in blocks if b.status == "available")
        fs_blocked = sum(1 for b in blocks if b.status == "blocked_by_fs")
        imt_blocked = sum(1 for b in blocks if b.status == "blocked_by_imt")
        guard_candidates = sum(1 for b in blocks if b.can_be_guard)
        
        log.append("")
        log.append("── สรุปผล ──")
        log.append(f"  ✅ พร้อมใช้งาน: {available} บล็อก")
        log.append(f"  ❌ ติด FS (-120dBm): {fs_blocked} บล็อก")
        log.append(f"  ❌ ติด IMT (100m buffer): {imt_blocked} บล็อก")
        log.append(f"  ⚠️ แนะนำย่านป้องกัน: {guard_candidates} บล็อก")
        
        summary = (
            f"จาก 19 บล็อก (4800-4990 MHz): "
            f"✅ {available} พร้อมใช้งาน, "
            f"❌FS {fs_blocked}, "
            f"❌IMT {imt_blocked}, "
            f"⚠️Guard {guard_candidates}"
        )
        
        log.append(f"  {summary}")
        log.append("=" * 60)
        
        return AllocationResult(
            blocks=blocks,
            narrative_log=log,
            existing_imt_count=len(imt_allocations),
            existing_fs_count=len(fs_links),
            selected_frame_structure=frame_structure,
            summary=summary,
        )
