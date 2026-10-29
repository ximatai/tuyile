-- Keep task/output/quota ownership for audit while removing deleted project content.
ALTER TABLE projects ADD COLUMN deleted_at timestamptz;
CREATE INDEX projects_visible ON projects(workspace_id,created_at DESC,id) WHERE deleted_at IS NULL;
