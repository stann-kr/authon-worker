-- Supabase -> D1 cutover metadata
-- Keeps legacy Supabase Auth identity for audit/linkage and tracks reset-link onboarding state.

ALTER TABLE users ADD COLUMN legacy_auth_user_id TEXT;
ALTER TABLE users ADD COLUMN migration_status TEXT NOT NULL DEFAULT 'native';
ALTER TABLE users ADD COLUMN migrated_at TEXT;
ALTER TABLE users ADD COLUMN password_set_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_legacy_auth_user_id ON users(legacy_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_migration_status ON users(migration_status);
