CREATE TABLE external_agent_tokens (
 project_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 user_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE,
 execution_version integer NOT NULL,
 expires_at timestamptz NOT NULL,
 scopes text[] NOT NULL CHECK (
   'canvas:read'=ANY(scopes) AND scopes <@ ARRAY['canvas:read','canvas:write','images:generate']
 ),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,user_id) REFERENCES workspaces(id,owner_id)
);
