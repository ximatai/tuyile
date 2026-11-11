ALTER TABLE external_agent_tokens
 DROP CONSTRAINT external_agent_tokens_scopes_check,
 ADD CONSTRAINT external_agent_tokens_scopes_check CHECK (
   'canvas:read'=ANY(scopes)
   AND scopes <@ ARRAY['canvas:read','canvas:write','images:generate','images:download']
   AND (project_id IS NULL OR NOT ('images:download'=ANY(scopes)))
 );
