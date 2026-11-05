-- Derived raster assets keep immutable vector lineage and share existing storage accounting.
ALTER TABLE image_assets ADD COLUMN derived_from uuid;
ALTER TABLE image_assets ADD CONSTRAINT image_assets_derived_source_fk FOREIGN KEY(workspace_id,derived_from) REFERENCES image_assets(workspace_id,id);
ALTER TABLE image_assets ADD CONSTRAINT image_assets_no_self_derivation CHECK(derived_from IS DISTINCT FROM id);
CREATE UNIQUE INDEX image_assets_live_derivative ON image_assets(workspace_id,derived_from) WHERE derived_from IS NOT NULL AND state IN ('staging','ready');
