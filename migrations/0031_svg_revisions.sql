ALTER TABLE image_assets ADD COLUMN revision_of uuid;
ALTER TABLE image_assets ADD CONSTRAINT image_assets_revision_source_fk FOREIGN KEY(workspace_id,revision_of) REFERENCES image_assets(workspace_id,id);
ALTER TABLE image_assets ADD CONSTRAINT image_assets_revision_shape CHECK (
  revision_of IS NULL OR (revision_of <> id AND derived_from IS NULL AND task_id IS NULL AND hash IS NOT NULL AND mime IS NOT DISTINCT FROM 'image/svg+xml')
);
CREATE UNIQUE INDEX image_assets_live_svg_revision ON image_assets(workspace_id,revision_of,hash)
  WHERE revision_of IS NOT NULL AND state IN ('staging','ready');
CREATE INDEX image_assets_svg_revision_source ON image_assets(workspace_id,revision_of,created_at,id)
  WHERE revision_of IS NOT NULL AND state IN ('staging','ready','deleting');
