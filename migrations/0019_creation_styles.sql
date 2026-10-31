CREATE TABLE creation_styles (
 id uuid PRIMARY KEY,
 workspace_id uuid REFERENCES workspaces(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 text text NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 2000),
 published boolean NOT NULL DEFAULT false,
 deleted boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creation_styles_workspace ON creation_styles(workspace_id) WHERE NOT deleted;
ALTER TABLE administration_audit DROP CONSTRAINT administration_audit_action_check;
ALTER TABLE administration_audit ADD CONSTRAINT administration_audit_action_check
 CHECK(action IN ('execution-settings','planning-policy','prompt-template-save','style-save'));
INSERT INTO creation_styles(id,name,text,published) VALUES
('00000000-0000-4000-8000-000000000001','真实摄影','真实摄影，自然光线，细腻材质，准确的光影与丰富细节。',true),
('00000000-0000-4000-8000-000000000002','商业产品','高端商业产品摄影，精致棚拍布光，主体清晰，构图简洁。',true),
('00000000-0000-4000-8000-000000000003','精致插画','专业编辑插画，清晰造型，丰富而协调的配色，精致完成度。',true),
('00000000-0000-4000-8000-000000000004','海报视觉','鲜明的海报构图，突出视觉焦点，预留排版空间，电影感配色。',true),
('00000000-0000-4000-8000-000000000005','头像角色','富有表现力的角色肖像，突出面部表情，干净背景，精致头像质感。',true);
