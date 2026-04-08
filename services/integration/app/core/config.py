"""
Application configuration — loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """
    All configuration is via environment variables.
    In k3s, these come from ConfigMaps and Secrets.
    """

    # --- Database ---
    database_url: str = Field(
        default="postgresql+asyncpg://coldchain:coldchain_dev_password@localhost:5432/coldchain",
        description="Async SQLAlchemy connection string",
    )

    # --- MQTT ---
    mqtt_host: str = Field(default="localhost")
    mqtt_port: int = Field(default=1883)
    mqtt_username: str = Field(default="coldchain")
    mqtt_password: str = Field(default="coldchain_dev")
    mqtt_topic_prefix: str = Field(default="application/+/device/+/event/up")

    # --- Auth (Keycloak) ---
    keycloak_url: str = Field(default="http://localhost:8081")
    keycloak_realm: str = Field(default="coldchain")
    keycloak_client_id: str = Field(default="coldchain-api")
    # For dev, we can disable auth
    auth_enabled: bool = Field(default=False)

    # --- Alerting ---
    smtp_host: str = Field(default="localhost")
    smtp_port: int = Field(default=1025)  # MailHog default
    smtp_username: str = Field(default="")
    smtp_password: str = Field(default="")
    smtp_from_email: str = Field(default="alerts@coldchain.local")
    smtp_use_tls: bool = Field(default=False)

    twilio_account_sid: str = Field(default="")
    twilio_auth_token: str = Field(default="")
    twilio_from_number: str = Field(default="")

    # --- General ---
    environment: str = Field(default="development")
    log_level: str = Field(default="INFO")
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)

    # --- Alert Engine ---
    alert_check_interval_seconds: int = Field(default=30)
    connectivity_check_interval_seconds: int = Field(default=60)

    model_config = {"env_prefix": "COLDCHAIN_"}


settings = Settings()
