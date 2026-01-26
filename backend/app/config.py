"""Application configuration."""
import os


class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-secret-key-change-in-production"
    JSON_SORT_KEYS = False
    
    # Persistence mode: "memory" or "json_file"
    PERSISTENCE_MODE = os.environ.get("PERSISTENCE_MODE", "memory")
    JSON_FILE_PATH = os.environ.get("JSON_FILE_PATH", "data.json")


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
