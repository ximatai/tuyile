CREATE TABLE library_favorites (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
 group_name text NOT NULL DEFAULT '' CHECK(length(group_name)<=60),
 asset_id uuid, prompt text CHECK(length(trim(prompt)) BETWEEN 1 AND 12000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((asset_id IS NULL)<>(prompt IS NULL)),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
CREATE INDEX library_favorites_workspace ON library_favorites(workspace_id,created_at DESC,id);
CREATE INDEX library_favorites_asset ON library_favorites(asset_id) WHERE asset_id IS NOT NULL;
