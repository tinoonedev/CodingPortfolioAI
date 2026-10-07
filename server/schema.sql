CREATE TABLE IF NOT EXISTS studio_workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_users (
  subject TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_workspace_members (
  workspace_id UUID NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
  user_subject TEXT NOT NULL REFERENCES studio_users(subject) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_subject)
);

CREATE TABLE IF NOT EXISTS studio_client_projects (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES studio_users(subject),
  name VARCHAR(70) NOT NULL,
  client VARCHAR(70) NOT NULL,
  problem VARCHAR(500) NOT NULL,
  target_user VARCHAR(250) NOT NULL,
  success_signal VARCHAR(250) NOT NULL,
  brief_approved_at TIMESTAMPTZ NOT NULL,
  brief_approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES studio_workspace_members(workspace_id, user_subject),
  FOREIGN KEY (workspace_id, brief_approved_by)
    REFERENCES studio_workspace_members(workspace_id, user_subject)
);

CREATE INDEX IF NOT EXISTS studio_client_projects_workspace_created_idx
  ON studio_client_projects (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_subject TEXT NOT NULL REFERENCES studio_users(subject) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_subject)
    REFERENCES studio_workspace_members(workspace_id, user_subject) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS studio_sessions_expiry_idx ON studio_sessions (expires_at);

CREATE TABLE IF NOT EXISTS studio_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, actor_subject)
    REFERENCES studio_workspace_members(workspace_id, user_subject)
);

CREATE INDEX IF NOT EXISTS studio_audit_events_workspace_created_idx
  ON studio_audit_events (workspace_id, created_at DESC);
