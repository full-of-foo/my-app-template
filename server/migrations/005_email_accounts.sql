-- Email accounts have no username; older accounts keep theirs until they add an email.
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_email ON users(firebase_email) WHERE firebase_email IS NOT NULL;
-- Resets and verification emails are rate-limited separately.
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_reset_at timestamptz;
INSERT INTO schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
