CREATE TABLE IF NOT EXISTS studio_auth_rate_limits (
  bucket_hash CHAR(64) PRIMARY KEY,
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
  window_expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_auth_rate_limits_expiry_idx
  ON studio_auth_rate_limits (window_expires_at);
