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

# Load repo-root .env for secrets (COLDCHAIN_CHIRPSTACK_API_TOKEN, etc.)
# The file is gitignored and never committed.
REPO_ENV="$SCRIPT_DIR/../../.env"
if [ -f "$REPO_ENV" ]; then
    # shellcheck disable=SC1090
    set -a; source "$REPO_ENV"; set +a
fi

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
export COLDCHAIN_CHIRPSTACK_API_URL="${COLDCHAIN_CHIRPSTACK_API_URL:-localhost:8080}"
export COLDCHAIN_CHIRPSTACK_API_TOKEN="${COLDCHAIN_CHIRPSTACK_API_TOKEN:-}"
export COLDCHAIN_CHIRPSTACK_TENANT_ID="${COLDCHAIN_CHIRPSTACK_TENANT_ID:-}"

echo ""
echo "==> Starting integration service (hot reload)"
echo "    API:        http://localhost:8000"
echo "    Docs:       http://localhost:8000/docs"
echo "    MQTT:       ${COLDCHAIN_MQTT_HOST}:${COLDCHAIN_MQTT_PORT}"
echo "    DB:         ${COLDCHAIN_DATABASE_URL}"
echo "    ChirpStack: ${COLDCHAIN_CHIRPSTACK_API_URL} (token: ${COLDCHAIN_CHIRPSTACK_API_TOKEN:+set}${COLDCHAIN_CHIRPSTACK_API_TOKEN:-NOT SET})"
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
