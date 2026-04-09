-- =============================================================================
-- Migration 001: Add ChirpStack foreign-key columns
--
-- Stores the ChirpStack application ID on each system and the ChirpStack
-- device profile ID on each device, enabling bidirectional sync.
--
-- Apply to a running database:
--   psql -U coldchain -d coldchain -f scripts/migrations/001_add_chirpstack_ids.sql
--
-- Or via kubectl:
--   kubectl exec -n coldchain svc/timescaledb -- \
--     psql -U coldchain -d coldchain -c "
--       ALTER TABLE systems ADD COLUMN IF NOT EXISTS chirpstack_application_id TEXT;
--       ALTER TABLE devices ADD COLUMN IF NOT EXISTS chirpstack_device_profile_id TEXT;
--     "
-- =============================================================================

ALTER TABLE systems
    ADD COLUMN IF NOT EXISTS chirpstack_application_id TEXT;

ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS chirpstack_device_profile_id TEXT;
