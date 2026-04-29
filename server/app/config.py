from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str
    AWS_SECRET_ACCESS_KEY: str
    S3_BUCKET_NAME: str
    S3_PUBLIC_BASE_URL: str = ""  # e.g. https://my-bucket.s3.amazonaws.com (auto-derived if empty)
    PORT: int = 8000
    CLIENT_ORIGIN: str = "http://localhost:5173"
    SERVER_BASE_URL: str = "http://localhost:8000"
    # Server-side Google Fonts API key. Kept on the backend so the browser
    # never makes a cross-origin request to googleapis.com (which is often
    # blocked by ad-blockers, privacy extensions, and corp DNS).
    GOOGLE_FONTS_API_KEY: str = ""

    @property
    def s3_public_base_url(self) -> str:
        if self.S3_PUBLIC_BASE_URL:
            return self.S3_PUBLIC_BASE_URL.rstrip("/")
        return f"https://{self.S3_BUCKET_NAME}.s3.{self.AWS_REGION}.amazonaws.com"


settings = Settings()  # type: ignore[call-arg]
