#!/bin/bash
# =============================================================================
# Run the integration service locally with hot reload.
# Requires: TimescaleDB and Mosquitto accessible on localhost
#   (via docker-compose or kubectl port-forward)
#
# Usage:
#   cd services/integration
#   ./run-dev.sh
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

# Default config for local development
export COLDCHAIN_DATABASE_URL="${COLDCHAIN_DATABASE_URL:-postgresql+asyncpg://coldchain:coldchain_dev_password@localhost:5432/coldchain}"
export COLDCHAIN_MQTT_HOST="${COLDCHAIN_MQTT_HOST:-localhost}"
export COLDCHAIN_MQTT_PORT="${COLDCHAIN_MQTT_PORT:-1883}"
export COLDCHAIN_MQTT_USERNAME="${COLDCHAIN_MQTT_USERNAME:-coldchain}"
export COLDCHAIN_MQTT_PASSWORD="${COLDCHAIN_MQTT_PASSWORD:-coldchain_dev}"
export COLDCHAIN_KEYCLOAK_URL="${COLDCHAIN_KEYCLOAK_URL:-http://localhost:8081/auth}"
export COLDCHAIN_KEYCLOAK_REALM="${COLDCHAIN_KEYCLOAK_REALM:-coldchain}"
export COLDCHAIN_KEYCLOAK_CLIENT_ID="${COLDCHAIN_KEYCLOAK_CLIENT_ID:-coldchain-api}"
export COLDCHAIN_ENVIRONMENT="${COLDCHAIN_ENVIRONMENT:-development}"
export COLDCHAIN_LOG_LEVEL="${COLDCHAIN_LOG_LEVEL:-DEBUG}"
export COLDCHAIN_SMTP_HOST="${COLDCHAIN_SMTP_HOST:-localhost}"
export COLDCHAIN_SMTP_PORT="${COLDCHAIN_SMTP_PORT:-1025}"

echo ""
echo "==> Starting integration service (hot reload)"
echo "    API:  http://localhost:8000"
echo "    Docs: http://localhost:8000/docs"
echo "    MQTT: ${COLDCHAIN_MQTT_HOST}:${COLDCHAIN_MQTT_PORT}"
echo "    DB:   ${COLDCHAIN_DATABASE_URL}"
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
