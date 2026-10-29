CREATE TABLE project_documents (
  workspace_id uuid NOT NULL, project_id uuid PRIMARY KEY,
  revision integer NOT NULL CHECK(revision>0), document jsonb NOT NULL,
  request_key uuid NOT NULL, request_hash text NOT NULL,
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE canvas_references (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL, asset_id uuid NOT NULL,
  PRIMARY KEY(project_id,asset_id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
CREATE INDEX canvas_references_asset ON canvas_references(asset_id);
CREATE TABLE output_placements (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL, output_id uuid NOT NULL,
  PRIMARY KEY(project_id,output_id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,output_id) REFERENCES image_outputs(workspace_id,id)
);
CREATE TABLE image_output_sources (
  workspace_id uuid NOT NULL, output_id uuid NOT NULL, asset_id uuid NOT NULL,
  PRIMARY KEY(output_id,asset_id),
  FOREIGN KEY(workspace_id,output_id) REFERENCES image_outputs(workspace_id,id),
  FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
INSERT INTO image_output_sources(workspace_id,output_id,asset_id)
SELECT o.workspace_id,o.id,a.id FROM image_outputs o JOIN image_tasks t ON t.id=o.task_id
CROSS JOIN LATERAL jsonb_array_elements_text(t.input->'referenceIds') ref(id)
JOIN image_assets a ON a.workspace_id=o.workspace_id AND a.id::text=ref.id ON CONFLICT DO NOTHING;
