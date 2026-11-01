ALTER TABLE image_assets ADD COLUMN demo_template_id uuid REFERENCES demo_templates(id);
CREATE INDEX demo_template_asset_lookup ON demo_template_assets(asset_id);
CREATE INDEX demo_project_image_lookup ON demo_projects USING gin(images jsonb_path_ops);
