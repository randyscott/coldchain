-- Migration 005: add UNIQUE (group_id, email) on users if not already present.
-- Safe to run repeatedly.

DO $$
BEGIN
    -- Normalise any remaining empty-string keycloak_id → NULL
    UPDATE users SET keycloak_id = NULL WHERE keycloak_id = '';

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_group_email_unique'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_group_email_unique UNIQUE (group_id, email);
        RAISE NOTICE 'Constraint users_group_email_unique added.';
    ELSE
        RAISE NOTICE 'Constraint users_group_email_unique already exists, skipping.';
    END IF;
END
$$;
