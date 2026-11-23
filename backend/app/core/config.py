from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "GlimsTech AI Core SaaS"
    API_V1_STR: str = "/api/v1"
    
    # Database Settings
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "bizflow_runtime"
    POSTGRES_PASSWORD: str = "bizflow_secure_runtime_2026"
    POSTGRES_DB: str = "platform_db"
    
    # JWT & Security
    SECRET_KEY: str = "bizflow_dev_secret_key_change_in_production_2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 # 24 hours

    # Groq & AI Configuration
    GROQ_API_KEY: Optional[str] = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_TEMPERATURE: float = 0.2
    GROQ_MAX_TOKENS: int = 1024
    GROQ_TIMEOUT_SECONDS: int = 30
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )
    
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

settings = Settings()
