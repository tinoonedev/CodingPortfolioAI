ALTER TABLE studio_users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS studio_users_email_lower_unique_idx
  ON studio_users (lower(email));

CREATE TABLE IF NOT EXISTS studio_account_invitations (
  token_hash CHAR(64) PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_account_invitations_expiry_idx
  ON studio_account_invitations (expires_at);
