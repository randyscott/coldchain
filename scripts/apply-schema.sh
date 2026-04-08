#!/bin/bash
# =============================================================================
# Initialize the coldchain application database schema.
# Run this after the base infrastructure is deployed and TimescaleDB is ready.
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="coldchain"

echo "==> Waiting for TimescaleDB pod to be ready..."
kubectl wait --for=condition=Ready pod/timescaledb-0 -n "$NAMESPACE" --timeout=120s

echo "==> Copying schema to TimescaleDB pod..."
kubectl cp "$SCRIPT_DIR/init-db.sql" "$NAMESPACE/timescaledb-0:/tmp/init-db.sql"

echo "==> Applying schema..."
kubectl exec -it timescaledb-0 -n "$NAMESPACE" -- \
    psql -U coldchain -d coldchain -f /tmp/init-db.sql

echo ""
echo "==> Schema applied successfully!"
echo ""
echo "==> Verifying tables..."
kubectl exec -it timescaledb-0 -n "$NAMESPACE" -- \
    psql -U coldchain -d coldchain -c "\dt"

echo ""
echo "==> Verifying hypertables..."
kubectl exec -it timescaledb-0 -n "$NAMESPACE" -- \
    psql -U coldchain -d coldchain -c "SELECT hypertable_name, num_dimensions FROM timescaledb_information.hypertables;"

echo ""
echo "==> Verifying continuous aggregates..."
kubectl exec -it timescaledb-0 -n "$NAMESPACE" -- \
    psql -U coldchain -d coldchain -c "SELECT view_name FROM timescaledb_information.continuous_aggregates;"

echo ""
echo "==> Verifying seed data..."
kubectl exec -it timescaledb-0 -n "$NAMESPACE" -- \
    psql -U coldchain -d coldchain -c "SELECT name, system_type FROM systems;"

echo ""
echo "==> Done! Database is ready."
