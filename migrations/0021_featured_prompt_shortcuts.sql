ALTER TABLE prompt_templates ADD COLUMN featured boolean NOT NULL DEFAULT false;
CREATE INDEX prompt_templates_featured ON prompt_templates(created_at,id) WHERE published AND featured;
-- Select initial recommendations without changing existing content or publication decisions.
UPDATE prompt_templates SET featured=true WHERE id IN ('product-studio','brand-banner','illustration-scene');
