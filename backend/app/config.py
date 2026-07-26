from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./stock_league.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # one week
    finnhub_api_key: str = ""
    starting_capital: float = 100_000.0
    league_invite_code: str = ""
    price_refresh_seconds: int = 60
    snapshot_hour_utc: int = 21
    cors_origins: str = "http://localhost:5173"


settings = Settings()
