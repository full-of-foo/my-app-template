ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email text;
CREATE TABLE IF NOT EXISTS email_challenges (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_challenges_user ON email_challenges(user_id);
INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
