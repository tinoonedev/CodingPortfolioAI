CREATE TABLE studio_openai_project_configs (
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  connected_by TEXT NOT NULL,
  encrypted_credentials JSONB NOT NULL,
  credential_key_id TEXT NOT NULL,
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  monthly_budget_usd NUMERIC(14, 6) NOT NULL CHECK (monthly_budget_usd > 0),
  max_input_bytes INTEGER NOT NULL CHECK (max_input_bytes BETWEEN 1 AND 1000000),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 32000),
  period_start DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  settled_spend_usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (settled_spend_usd >= 0),
  reserved_spend_usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (reserved_spend_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES studio_client_projects(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, connected_by) REFERENCES studio_workspace_members(workspace_id, user_subject),
  CHECK (jsonb_typeof(encrypted_credentials) = 'object'),
  CHECK (encrypted_credentials->>'version' = '1'),
  CHECK (encrypted_credentials->>'keyId' = credential_key_id),
  CHECK (credential_key_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$')
);

CREATE TABLE studio_agent_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  actor_subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('product-manager', 'business-analyst', 'project-manager', 'qa-analyst')),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'unknown')),
  provider_request_id TEXT CHECK (provider_request_id IS NULL OR char_length(provider_request_id) <= 255),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN ('authentication', 'permission', 'rate_limit', 'invalid_request', 'provider_unavailable', 'invalid_response', 'timeout', 'network')),
  reserved_usd NUMERIC(14, 6) NOT NULL CHECK (reserved_usd >= 0),
  cost_usd NUMERIC(14, 6),
  input_tokens INTEGER,
  output_tokens INTEGER,
  artifact TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (workspace_id, project_id) REFERENCES studio_client_projects(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, actor_subject) REFERENCES studio_workspace_members(workspace_id, user_subject)
);

CREATE INDEX studio_agent_runs_project_created_idx ON studio_agent_runs(workspace_id, project_id, started_at DESC);
