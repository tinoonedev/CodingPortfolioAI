CREATE TABLE studio_jira_connections (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  connected_by TEXT NOT NULL,
  cloud_id TEXT NOT NULL CHECK (char_length(cloud_id) BETWEEN 1 AND 255),
  site_url TEXT NOT NULL CHECK (site_url ~ '^https://[^/]+/?$'),
  jira_project_id TEXT NOT NULL CHECK (char_length(jira_project_id) BETWEEN 1 AND 255),
  jira_project_key TEXT NOT NULL CHECK (jira_project_key ~ '^[A-Z][A-Z0-9_]{0,49}$'),
  encrypted_credentials JSONB,
  credential_key_id TEXT,
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  access_token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES studio_client_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, connected_by)
    REFERENCES studio_workspace_members (workspace_id, user_subject) ON DELETE CASCADE,
  CHECK (
    (status = 'connected'
      AND jsonb_typeof(encrypted_credentials) = 'object'
      AND encrypted_credentials->>'version' = '1'
      AND encrypted_credentials->>'keyId' = credential_key_id
      AND credential_key_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$')
    OR
    (status = 'disconnected' AND encrypted_credentials IS NULL AND credential_key_id IS NULL)
  )
);

CREATE INDEX studio_jira_connections_workspace_status_idx
  ON studio_jira_connections (workspace_id, status, updated_at DESC);

CREATE INDEX studio_jira_connections_key_rotation_idx
  ON studio_jira_connections (credential_key_id) WHERE status = 'connected';
