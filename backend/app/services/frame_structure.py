"""
Frame Structure Engine — PAFC Phase 37

TDD frame structure comparison for guard band determination.
When adjacent IMT allocations have different frame structures,
a guard band is required to prevent interference.

Reference: 3GPP TS 38.213 (NR Physical layer procedures for control)

Key concepts:
  - TDD configuration defines DL/UL slot pattern
  - Same pattern → compatible → no guard band
  - Different pattern → incompatible → need guard band
  - Adjacent allocations with same pattern may still need guard band
    depending on synchronization requirements
"""

from typing import List, Dict, Optional
from dataclasses import dataclass, field
from enum import Enum


# ── TDD Pattern Definitions ──────────────────────────────────────────────

class SlotType(str, Enum):
    """Slot type in TDD frame"""
    DL = "D"      # Downlink
    UL = "U"      # Uplink
    SPECIAL = "S" # Special (guard period + switching)


@dataclass
class TDDPattern:
    """
    TDD frame structure pattern.
    
    Attributes:
        name: Display name (e.g., "DDDSU")
        pattern: Slot sequence (e.g., ["D","D","D","S","U"])
        period_ms: Frame period (5 or 10 ms)
        dl_ratio: DL slot ratio (0.0-1.0)
        description_th: Thai description
    """
    name: str
    pattern: List[str]
    period_ms: float
    dl_ratio: float
    description_th: str


# Standard TDD patterns for n79 (4800-4990 MHz)
# Based on 3GPP TS 38.213 Table 11.1.1-1

STANDARD_PATTERNS: Dict[str, TDDPattern] = {
    "DDDSU": TDDPattern(
        name="DDDSU",
        pattern=["D","D","D","S","U"],
        period_ms=2.5,
        dl_ratio=0.80,
        description_th="รูปแบบ 2.5ms — 3 Downlink, 1 Special, 1 Uplink (นิยมใช้ทั่วไป)",
    ),
    "DSUUU": TDDPattern(
        name="DSUUU",
        pattern=["D","S","U","U","U"],
        period_ms=2.5,
        dl_ratio=0.40,
        description_th="รูปแบบ 2.5ms — 1 Downlink, 1 Special, 3 Uplink (เน้น Uplink)",
    ),
    "DDDDDDDSU": TDDPattern(
        name="DDDDDDDSU",
        pattern=["D","D","D","D","D","D","D","S","U"],
        period_ms=5.0,
        dl_ratio=0.89,
        description_th="รูปแบบ 5ms — 7 Downlink, 1 Special, 1 Uplink (เน้น Downlink สูง)",
    ),
    "DSUUU_DDDDD": TDDPattern(
        name="DSUUU_DDDDD",
        pattern=["D","S","U","U","U"] + ["D","D","D","D","D"],
        period_ms=5.0,
        dl_ratio=0.60,
        description_th="รูปแบบ 5ms — ครึ่งแรก Uplink, ครึ่งหลัง Downlink",
    ),
    "DDDDDDSUU": TDDPattern(
        name="DDDDDDSUU",
        pattern=["D","D","D","D","D","D","S","U","U"],
        period_ms=5.0,
        dl_ratio=0.78,
        description_th="รูปแบบ 5ms — 6 Downlink, 1 Special, 2 Uplink",
    ),
    "DDDSUDDSUU": TDDPattern(
        name="DDDSUDDSUU",
        pattern=["D","D","D","S","U"] + ["D","D","S","U","U"],
        period_ms=5.0,
        dl_ratio=0.60,
        description_th="รูปแบบ 5ms — สลับ DL/UL ในครึ่งเฟรม",
    ),
}


# ── Guard Band Determination ─────────────────────────────────────────────

@dataclass
class FrameCompatibilityResult:
    """Result of frame structure compatibility check"""
    pattern_a: str
    pattern_b: str
    compatible: bool
    need_guard_band: bool
    guard_band_width_khz: int = 0
    reason_th: str = ""


def check_frame_compatibility(
    frame_a: str,
    frame_b: str,
) -> FrameCompatibilityResult:
    """
    Check if two TDD frame structures are compatible.
    
    Rules:
      1. Same pattern → compatible → NO guard band needed
      2. Different pattern:
         - Same DL ratio (±10%) → partially compatible → guard band recommended
         - Different DL ratio → incompatible → guard band REQUIRED
    
    Args:
        frame_a: TDD pattern name (e.g., "DDDSU")
        frame_b: TDD pattern name (e.g., "DDDDDDDSU")
    
    Returns:
        FrameCompatibilityResult with compatibility + guard band recommendation
    """
    pat_a = STANDARD_PATTERNS.get(frame_a)
    pat_b = STANDARD_PATTERNS.get(frame_b)
    
    if not pat_a or not pat_b:
        unknown = [f for f in [frame_a, frame_b] if f not in STANDARD_PATTERNS]
        return FrameCompatibilityResult(
            pattern_a=frame_a,
            pattern_b=frame_b,
            compatible=False,
            need_guard_band=True,
            guard_band_width_khz=20000,  # 20 MHz guard for unknown patterns
            reason_th=f"ไม่รู้จักรูปแบบ TDD: {', '.join(unknown)} — กำหนดย่านป้องกัน 20 MHz",
        )
    
    # Same pattern → compatible
    if frame_a == frame_b:
        return FrameCompatibilityResult(
            pattern_a=frame_a,
            pattern_b=frame_b,
            compatible=True,
            need_guard_band=False,
            reason_th=f"ใช้รูปแบบ {frame_a} เหมือนกัน — เข้ากันได้ ไม่ต้องใช้ย่านป้องกัน",
        )
    
    # Different patterns — check DL ratio compatibility
    dl_diff = abs(pat_a.dl_ratio - pat_b.dl_ratio)
    period_diff = abs(pat_a.period_ms - pat_b.period_ms)
    
    if dl_diff <= 0.10 and period_diff < 0.1:
        # Similar DL ratio + same period → partially compatible
        return FrameCompatibilityResult(
            pattern_a=frame_a,
            pattern_b=frame_b,
            compatible=False,
            need_guard_band=True,
            guard_band_width_khz=5000,  # 5 MHz guard band
            reason_th=(
                f"รูปแบบต่างกัน ({frame_a} vs {frame_b}) "
                f"แต่มีสัดส่วน DL ใกล้เคียงกัน ({pat_a.dl_ratio:.0%} vs {pat_b.dl_ratio:.0%}) — "
                f"แนะนำย่านป้องกัน 5 MHz"
            ),
        )
    elif dl_diff <= 0.20:
        # Moderate DL ratio difference → guard band needed
        return FrameCompatibilityResult(
            pattern_a=frame_a,
            pattern_b=frame_b,
            compatible=False,
            need_guard_band=True,
            guard_band_width_khz=10000,  # 10 MHz guard band
            reason_th=(
                f"รูปแบบต่างกัน ({frame_a} vs {frame_b}) "
                f"สัดส่วน DL ต่างกัน ({pat_a.dl_ratio:.0%} vs {pat_b.dl_ratio:.0%}) — "
                f"ต้องใช้ย่านป้องกัน 10 MHz"
            ),
        )
    else:
        # Large DL ratio difference → wide guard band
        return FrameCompatibilityResult(
            pattern_a=frame_a,
            pattern_b=frame_b,
            compatible=False,
            need_guard_band=True,
            guard_band_width_khz=20000,  # 20 MHz guard band
            reason_th=(
                f"รูปแบบต่างกันมาก ({frame_a} vs {frame_b}) "
                f"สัดส่วน DL ต่างกันมาก ({pat_a.dl_ratio:.0%} vs {pat_b.dl_ratio:.0%}) — "
                f"ต้องใช้ย่านป้องกัน 20 MHz"
            ),
        )


def get_frame_structure_options() -> List[dict]:
    """
    Return available TDD frame structure options for UI dropdown.
    
    Returns:
        List of {value, label, description}
    """
    return [
        {
            "value": name,
            "label": name,
            "description": pat.description_th,
            "dl_ratio": pat.dl_ratio,
            "period_ms": pat.period_ms,
        }
        for name, pat in STANDARD_PATTERNS.items()
    ]


def determine_guard_blocks(
    proposed_block_indices: List[int],  # 0-18
    adjacent_imt_frame_structure: str,
    current_frame_structure: str,
) -> dict:
    """
    Determine which blocks should be guard bands based on frame structure
    compatibility with adjacent IMT allocations.
    
    Args:
        proposed_block_indices: indices of proposed blocks [0, 1, ..., 18]
        adjacent_imt_frame_structure: frame structure of adjacent IMT
        current_frame_structure: frame structure of current IMT
    
    Returns:
        {
            "compatible": bool,
            "need_guard_band": bool,
            "guard_block_indices": [int],  # which block indices should be guard
            "reason_th": str,
        }
    """
    result = check_frame_compatibility(
        adjacent_imt_frame_structure,
        current_frame_structure,
    )
    
    if not result.need_guard_band:
        return {
            "compatible": True,
            "need_guard_band": False,
            "guard_block_indices": [],
            "reason_th": result.reason_th,
        }
    
    # Determine how many 10MHz blocks needed for guard band
    guard_mhz = result.guard_band_width_khz / 1000.0
    num_guard_blocks = max(1, int(guard_mhz / 10))
    
    # Guard blocks are the blocks closest to the adjacent allocation
    # For simplicity: take the edge blocks
    if proposed_block_indices:
        guard_indices = proposed_block_indices[:num_guard_blocks]
    else:
        guard_indices = []
    
    return {
        "compatible": False,
        "need_guard_band": True,
        "guard_band_width_khz": result.guard_band_width_khz,
        "guard_block_indices": guard_indices,
        "reason_th": result.reason_th,
    }
