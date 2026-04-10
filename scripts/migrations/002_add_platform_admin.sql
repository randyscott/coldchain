-- =============================================================================
-- Migration 002: Add platform admin flag to users
--
-- Adds is_platform_admin to the users table and bootstraps the demo admin.
-- Platform admins bypass group_id scoping and can access all tenants.
--
-- Apply:
--   psql -U coldchain -d coldchain -f scripts/migrations/002_add_platform_admin.sql
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Bootstrap the demo admin as platform admin for fresh installs.
-- On real deployments, set this manually with:
--   UPDATE users SET is_platform_admin = TRUE WHERE email = 'your-admin@example.com';
UPDATE users SET is_platform_admin = TRUE WHERE email = 'admin@demo.local';
