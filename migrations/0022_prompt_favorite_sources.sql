ALTER TABLE library_favorites ADD COLUMN source_prompt_id text REFERENCES prompt_templates(id);
CREATE UNIQUE INDEX favorite_prompt_source ON library_favorites(workspace_id,source_prompt_id) WHERE source_prompt_id IS NOT NULL;
