-- Public product templates. Personal favorites remain independent snapshots.
CREATE TABLE prompt_templates (
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
 category text NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 60),
 prompt text NOT NULL CHECK(length(trim(prompt)) BETWEEN 1 AND 12000),
 published boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prompt_templates_public ON prompt_templates(created_at,id) WHERE published;
INSERT INTO prompt_templates(id,title,category,prompt,published) VALUES
('product-studio','简洁商品展示','商品','为参考商品设计简洁的棚拍展示图，保持主体形状、材质与标识，使用柔和侧光和干净背景。不要虚构商品功能或添加无关文字。',true),
('brand-banner','品牌宣传构图','宣传','设计一张主体突出、留白充足的品牌宣传图。先明确核心视觉与画面层次，在右侧预留标题区域；保持参考主体一致。',true),
('illustration-scene','叙事插画场景','插画','围绕我描述的主题创作叙事插画，明确主体动作、环境和光线，采用统一配色与清楚的前中后景。画面中不添加无关文字。',true);
