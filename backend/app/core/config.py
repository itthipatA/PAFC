from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://pafc:pafc@localhost:5432/pafc"

    # JWT
    jwt_secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours

    # Block allocation
    band_start_mhz: float = 4800.0
    band_end_mhz: float = 4990.0
    block_size_mhz: float = 10.0
    default_guard_band_mhz: float = 10.0

    # Propagation defaults
    default_propagation_model: str = "free_space"
    interference_threshold_dbm: float = -114.0  # I/N ratio at FS receiver
    protection_ratio_db: float = 20.0

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Propagation model configs
    propagation_models: dict = {
        "free_space": {"name": "Free Space Path Loss", "params": [], "reference": "ITU-R P.525"},
        "p452": {"name": "ITU-R P.452 Interference", "params": ["time_pct", "clutter_class"], "reference": "ITU-R P.452"},
        "p2108": {"name": "ITU-R P.2108 Clutter", "params": ["clutter_type", "percentage_locations"], "reference": "ITU-R P.2108"},
        "p1411": {"name": "ITU-R P.1411 Short-Range", "params": ["environment", "street_width_m", "building_height_m"], "reference": "ITU-R P.1411"},
        "p526": {"name": "ITU-R P.526", "description": "Diffraction loss", "params": []},
        "p530": {"name": "ITU-R P.530", "description": "FS link reliability", "params": []},
        "hata": {"name": "Hata Model", "description": "Urban/suburban mobile", "params": ["environment"]},
    }

    model_config = {"env_prefix": "PAFC_"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
