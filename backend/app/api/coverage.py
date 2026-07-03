"""
Coverage API — Link Budget Calculator endpoints
POST /api/coverage/calculate
"""
from fastapi import APIRouter
from app.services.coverage import CoverageEngine, quick_radius, quick_eirp

router = APIRouter()


@router.post("/calculate")
async def calculate_coverage(data: dict):
    """
    Standalone link budget calculation.
    
    Request:
    {
        "cell_radius": 500,           // meters
        "bs_antenna_height": 15,      // optional, default 15m
        "bs_antenna_gain": 12,        // optional, default 12 dBi
        "model": "free_space",        // optional
        "target_rss": -95,            // optional, default -95 dBm
        "shadow_margin": 8,           // optional, default 8 dB
        "building_loss": 0,           // optional, default 0 dB
        "ue_antenna_gain": 0,         // optional, default 0 dBi
        "body_loss": 0,               // optional, default 0 dB
        "center_freq": 4900           // optional, default 4900 MHz
    }
    
    Also accepts reverse mode:
    {
        "eirp": 23,                   // dBm (for reverse calculation)
        ...
    }
    """
    model_name = data.get("model", "free_space")
    engine = CoverageEngine(propagation_model=model_name)
    
    if "eirp" in data:
        # Reverse: EIRP → achievable radius
        eirp = float(data["eirp"])
        radius = engine.calculate_achievable_radius(
            eirp_dbm=eirp,
            bs_antenna_height_m=float(data.get("bs_antenna_height", 15)),
            bs_antenna_gain_dbi=float(data.get("bs_antenna_gain", 12)),
            target_rss_dbm=data.get("target_rss"),
            shadow_margin_db=data.get("shadow_margin"),
            building_loss_db=data.get("building_loss"),
            ue_antenna_gain_dbi=data.get("ue_antenna_gain"),
            body_loss_db=data.get("body_loss"),
            center_freq_mhz=data.get("center_freq"),
        )
        return {
            "mode": "reverse",
            "eirp_dbm": eirp,
            "achievable_radius_m": round(radius, 0),
            "propagation_model": model_name,
        }
    
    # Forward: cell_radius → required EIRP
    cell_radius = float(data["cell_radius"])
    result = engine.calculate_required_eirp(
        cell_radius_m=cell_radius,
        bs_antenna_height_m=float(data.get("bs_antenna_height", 15)),
        bs_antenna_gain_dbi=float(data.get("bs_antenna_gain", 12)),
        target_rss_dbm=data.get("target_rss"),
        shadow_margin_db=data.get("shadow_margin"),
        building_loss_db=data.get("building_loss"),
        ue_antenna_gain_dbi=data.get("ue_antenna_gain"),
        body_loss_db=data.get("body_loss"),
        center_freq_mhz=data.get("center_freq"),
    )
    
    return {
        "mode": "forward",
        "cell_radius_m": result.cell_radius_m,
        "required_eirp_dbm": round(result.required_eirp_dbm, 1),
        "cell_edge_rss_dbm": round(result.cell_edge_rss_dbm, 1),
        "max_path_loss_db": round(result.max_path_loss_db, 1),
        "actual_path_loss_db": round(result.actual_path_loss_db, 1),
        "link_margin_db": round(result.link_margin_db, 1),
        "coverage_classification": result.coverage_classification,
        "parameters": {
            "target_rss_dbm": result.target_rss_dbm,
            "shadow_margin_db": result.shadow_margin_db,
            "building_loss_db": result.building_loss_db,
            "ue_antenna_gain_dbi": result.ue_antenna_gain_dbi,
            "body_loss_db": result.body_loss_db,
            "center_freq_mhz": result.center_freq_mhz,
        },
        "propagation_model": model_name,
    }
