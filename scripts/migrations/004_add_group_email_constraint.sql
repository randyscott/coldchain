-- Migration 004: add UNIQUE (group_id, email) constraint to users.
--
-- Migration 003 may have rolled back silently because the duplicate-row DELETE
-- violated FK constraints: alert_events.acknowledged_by and audit_log.user_id
-- both reference users(id).
--
-- This migration re-attempts deduplication safely by:
--   1. Normalising empty keycloak_id → NULL (idempotent).
--   2. Rerouting all FK references from "loser" rows to "winner" rows.
--   3. Deleting loser rows (now FK-safe).
--   4. Adding the constraint.

BEGIN;

-- 1. Normalise empty keycloak_id → NULL (idempotent with 003)
UPDATE users SET keycloak_id = NULL WHERE keycloak_id = '';

-- 2a. Reroute alert_events.acknowledged_by from losers → winners
WITH winners AS (
    SELECT DISTINCT ON (group_id, email) id AS winner_id, group_id, email
    FROM users
    ORDER BY
        group_id, email,
        is_platform_admin DESC,
        (keycloak_id IS NOT NULL) DESC,
        created_at ASC
),
losers AS (
    SELECT u.id AS loser_id, w.winner_id
    FROM users u
    JOIN winners w ON w.group_id = u.group_id AND w.email = u.email
    WHERE u.id <> w.winner_id
)
UPDATE alert_events
SET acknowledged_by = l.winner_id
FROM losers l
WHERE alert_events.acknowledged_by = l.loser_id;

-- 2b. Reroute audit_log.user_id from losers → winners
WITH winners AS (
    SELECT DISTINCT ON (group_id, email) id AS winner_id, group_id, email
    FROM users
    ORDER BY
        group_id, email,
        is_platform_admin DESC,
        (keycloak_id IS NOT NULL) DESC,
        created_at ASC
),
losers AS (
    SELECT u.id AS loser_id, w.winner_id
    FROM users u
    JOIN winners w ON w.group_id = u.group_id AND w.email = u.email
    WHERE u.id <> w.winner_id
)
UPDATE audit_log
SET user_id = l.winner_id
FROM losers l
WHERE audit_log.user_id = l.loser_id;

-- 3. Delete loser rows (FK references have been rerouted above)
DELETE FROM users
WHERE id NOT IN (
    SELECT DISTINCT ON (group_id, email) id
    FROM users
    ORDER BY
        group_id, email,
        is_platform_admin DESC,
        (keycloak_id IS NOT NULL) DESC,
        created_at ASC
);

-- 4. Add the constraint (skip if it somehow already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_group_email_unique'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_group_email_unique UNIQUE (group_id, email);
    END IF;
END
$$;

COMMIT;
