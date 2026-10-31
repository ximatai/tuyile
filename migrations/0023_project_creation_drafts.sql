CREATE TABLE project_creation_drafts (
 workspace_id uuid NOT NULL, project_id uuid PRIMARY KEY,
 revision integer NOT NULL CHECK(revision>0), document jsonb NOT NULL,
 request_key uuid NOT NULL, request_hash text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE draft_references (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, asset_id uuid NOT NULL,
 PRIMARY KEY(project_id,asset_id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
CREATE INDEX draft_references_asset ON draft_references(asset_id);
