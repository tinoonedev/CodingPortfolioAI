ALTER TABLE studio_openai_project_configs
  DROP CONSTRAINT IF EXISTS studio_openai_project_configs_workspace_id_connected_by_fkey;

ALTER TABLE studio_openai_project_configs
  ADD CONSTRAINT studio_openai_project_configs_connected_by_member_fkey
  FOREIGN KEY (workspace_id, connected_by)
  REFERENCES studio_workspace_members(workspace_id, user_subject)
  ON DELETE CASCADE;
