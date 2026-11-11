ALTER TABLE external_agent_tokens
 DROP CONSTRAINT external_agent_tokens_pkey,
 ALTER COLUMN project_id DROP NOT NULL,
 ALTER COLUMN token_hash DROP NOT NULL,
 ADD UNIQUE (project_id),
 ADD CHECK (project_id IS NULL OR token_hash IS NOT NULL);

CREATE UNIQUE INDEX external_agent_account_grant
 ON external_agent_tokens(user_id) WHERE project_id IS NULL;
