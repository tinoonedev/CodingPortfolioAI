ALTER TABLE studio_client_projects
  ADD COLUMN IF NOT EXISTS creation_request_id UUID,
  ADD COLUMN IF NOT EXISTS creation_request_digest CHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studio_client_projects_workspace_creation_request_unique'
      AND conrelid = 'studio_client_projects'::regclass
  ) THEN
    ALTER TABLE studio_client_projects
      ADD CONSTRAINT studio_client_projects_workspace_creation_request_unique
      UNIQUE (workspace_id, creation_request_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studio_client_projects_creation_request_pair_check'
      AND conrelid = 'studio_client_projects'::regclass
  ) THEN
    ALTER TABLE studio_client_projects
      ADD CONSTRAINT studio_client_projects_creation_request_pair_check
      CHECK ((creation_request_id IS NULL) = (creation_request_digest IS NULL));
  END IF;
END $$;
