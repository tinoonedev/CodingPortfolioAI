CREATE TABLE studio_jira_oauth_transactions (
  state_hash CHAR(64) PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_subject TEXT NOT NULL,
  session_token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES studio_client_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_subject)
    REFERENCES studio_workspace_members (workspace_id, user_subject) ON DELETE CASCADE,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  CHECK (session_token_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX studio_jira_oauth_transactions_expiry_idx
  ON studio_jira_oauth_transactions (expires_at);

CREATE TABLE studio_jira_pending_authorizations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_subject TEXT NOT NULL,
  session_token_hash CHAR(64) NOT NULL,
  encrypted_credentials JSONB NOT NULL,
  credential_key_id TEXT NOT NULL,
  granted_scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES studio_client_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_subject)
    REFERENCES studio_workspace_members (workspace_id, user_subject) ON DELETE CASCADE,
  CHECK (jsonb_typeof(encrypted_credentials) = 'object'),
  CHECK (encrypted_credentials->>'version' = '1'),
  CHECK (encrypted_credentials->>'keyId' = credential_key_id),
  CHECK (credential_key_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CHECK (session_token_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX studio_jira_pending_authorizations_expiry_idx
  ON studio_jira_pending_authorizations (expires_at);
