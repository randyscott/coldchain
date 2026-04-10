-- Migration 003: fix user identity — switch conflict key to (group_id, email)
--
-- Root cause: when the Keycloak JWT sub is empty the upsert stores keycloak_id=''
-- for every user, so all logins conflict on the same empty-string key and
-- overwrite a single row rather than creating separate rows.
--
-- Fix:
--   1. Normalise empty-string keycloak_id to NULL (NULLs never conflict).
--   2. Deduplicate on (group_id, email), keeping the most valuable row.
--   3. Add a unique constraint on (group_id, email) so auth/sync can use it
--      as the conflict target going forward.

BEGIN;

-- 1. Normalise empty keycloak_id → NULL
UPDATE users SET keycloak_id = NULL WHERE keycloak_id = '';

-- 2. Deduplicate: for each (group_id, email) pair keep the single "best" row.
--    Priority: is_platform_admin DESC, keycloak_id present DESC, oldest row.
DELETE FROM users
WHERE id NOT IN (
    SELECT DISTINCT ON (group_id, email) id
    FROM users
    ORDER BY
        group_id,
        email,
        is_platform_admin DESC,
        (keycloak_id IS NOT NULL) DESC,
        created_at ASC
);

-- 3. Add unique constraint
ALTER TABLE users
    ADD CONSTRAINT users_group_email_unique UNIQUE (group_id, email);

COMMIT;
