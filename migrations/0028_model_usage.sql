ALTER TABLE image_attempts ADD COLUMN model_usage jsonb, ADD COLUMN price_snapshot jsonb,
 ADD COLUMN reference_usd numeric(24,12) CHECK(reference_usd>=0);
ALTER TABLE planning_attempts ADD COLUMN model_usage jsonb, ADD COLUMN price_snapshot jsonb,
 ADD COLUMN reference_usd numeric(24,12) CHECK(reference_usd>=0);
-- Preserve known historical totals. Cache and image details were not retained.
UPDATE planning_attempts SET model_usage=jsonb_build_object('inputTokens',input_tokens,'outputTokens',output_tokens,
 'cachedInputTokens',NULL,'textInputTokens',input_tokens,'imageInputTokens',0)
 WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL;
CREATE INDEX image_attempts_usage_time ON image_attempts(created_at);
CREATE INDEX planning_attempts_usage_time ON planning_attempts(created_at);
