CREATE UNIQUE INDEX studio_jira_oauth_transactions_session_project_idx
  ON studio_jira_oauth_transactions (workspace_id, project_id, session_token_hash);
