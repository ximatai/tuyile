CREATE TABLE external_agent_activity (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 workspace_id uuid NOT NULL,
 project_id uuid NOT NULL,
 user_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('grant_issued','grant_revoked','canvas_edited','image_submitted','canvas_undone')),
 scopes text[],
 revision integer,
 task_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,user_id) REFERENCES workspaces(id,owner_id)
);
CREATE INDEX external_agent_activity_project ON external_agent_activity(workspace_id,project_id,id DESC);
