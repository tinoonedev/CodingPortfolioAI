CREATE TABLE studio_project_requirement_revisions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  brief_hash CHAR(64) NOT NULL CHECK (brief_hash ~ '^[0-9a-f]{64}$'),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 60000),
  scenarios JSONB NOT NULL CHECK (jsonb_typeof(scenarios) = 'array'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, revision),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES studio_client_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES studio_workspace_members (workspace_id, user_subject)
);

CREATE INDEX studio_project_requirement_revisions_history_idx
  ON studio_project_requirement_revisions (workspace_id, project_id, revision DESC);
