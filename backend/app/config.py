"""Application configuration."""
import os


def _get_bool_env(name: str, default: str = "false") -> bool:
    value = os.environ.get(name, default)
    return value.strip().lower() in ("1", "true", "yes", "on")


class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-secret-key-change-in-production"
    JSON_SORT_KEYS = False
    SEED_DATA = _get_bool_env("SEED_DATA", "false")
    
    # Repository backend: "inmemory" or "sqlite"
    REPO_BACKEND = os.environ.get("REPO_BACKEND", "inmemory")
    
    # SQLite database path (only used when REPO_BACKEND=sqlite)
    DB_PATH = os.environ.get("DB_PATH", "./data/app.db")


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False


config = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
}
