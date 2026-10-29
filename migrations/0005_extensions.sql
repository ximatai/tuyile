ALTER TABLE image_provider_versions ADD COLUMN capabilities jsonb NOT NULL DEFAULT '[]';
UPDATE image_provider_versions p SET capabilities=(SELECT jsonb_agg(jsonb_build_object('model',m,'generation',true,'editing',true,'maxReferences',4,'maxEdge',8192,'maxPixels',32000000,'sizes','[]'::jsonb,'qualities','["low","medium","high"]'::jsonb,'formats','["png","jpeg","webp"]'::jsonb)) FROM jsonb_array_elements_text(p.models) m);
CREATE TABLE planning_provider_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),mode text NOT NULL CHECK(mode IN ('fake','openai')),
 base_url text NOT NULL,model text NOT NULL,secret_cipher text NOT NULL,
 response_mode text NOT NULL CHECK(response_mode IN ('text','json_object')),
 max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 256 AND 8192),
 max_input_characters integer NOT NULL CHECK(max_input_characters BETWEEN 1000 AND 64000),
 active boolean NOT NULL DEFAULT true,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_planning_provider ON planning_provider_versions(active) WHERE active;
CREATE TABLE tool_controls (
 tool_id text NOT NULL,version integer NOT NULL CHECK(version>0),enabled boolean NOT NULL DEFAULT true,
 revoked boolean NOT NULL DEFAULT false,PRIMARY KEY(tool_id,version)
);
INSERT INTO tool_controls(tool_id,version) VALUES('image.generate',1),('image.edit',1);
CREATE TABLE skill_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),skill_key text NOT NULL,version integer NOT NULL CHECK(version>0),
 definition jsonb NOT NULL,enabled boolean NOT NULL DEFAULT true,revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(skill_key,version)
);
CREATE UNIQUE INDEX one_enabled_skill_version ON skill_versions(skill_key) WHERE enabled;
ALTER TABLE image_tasks ADD COLUMN tool_id text NOT NULL DEFAULT 'image.generate';
ALTER TABLE image_tasks ADD COLUMN tool_version integer NOT NULL DEFAULT 1;
UPDATE image_tasks SET tool_id='image.edit' WHERE jsonb_array_length(coalesce(input->'referenceIds','[]'::jsonb))>0;
ALTER TABLE image_tasks ADD FOREIGN KEY(tool_id,tool_version) REFERENCES tool_controls(tool_id,version);
