CREATE TABLE demo_templates (
 id uuid PRIMARY KEY, created_by uuid NOT NULL REFERENCES users(id), source_project_id uuid NOT NULL,
 name text NOT NULL, request_hash text NOT NULL, manifest jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_demo_template ON demo_templates(active) WHERE active;
CREATE TABLE demo_template_assets (
 template_id uuid NOT NULL REFERENCES demo_templates(id), workspace_id uuid NOT NULL,
 asset_id uuid NOT NULL, PRIMARY KEY(template_id,asset_id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
CREATE TABLE demo_provisioning (
 user_id uuid PRIMARY KEY REFERENCES users(id), template_id uuid NOT NULL REFERENCES demo_templates(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','failed','ready')),
 project_id uuid, plan jsonb, opened_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_projects (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, template_id uuid NOT NULL REFERENCES demo_templates(id),
 images jsonb NOT NULL, PRIMARY KEY(workspace_id,project_id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
