CREATE TABLE external_agent_canvas_undo (
 project_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 document jsonb NOT NULL,
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE
);
