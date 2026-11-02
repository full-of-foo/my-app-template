ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_state text CHECK (firebase_state IN ('pending','active','deleting'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_last_mail_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS firebase_valid_after text;
INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
