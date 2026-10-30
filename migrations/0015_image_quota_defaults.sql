ALTER TABLE image_policies DROP CONSTRAINT image_policies_image_limit_check;
ALTER TABLE image_policies ADD CONSTRAINT image_policies_image_limit_check CHECK(image_limit>=-1);
ALTER TABLE image_policies ALTER COLUMN image_limit SET DEFAULT 100;
ALTER TABLE image_policies ALTER COLUMN attempts_limit SET DEFAULT 300;
-- Adopt the new defaults for the previous default values; preserve other configured limits.
UPDATE image_policies p SET image_limit=CASE WHEN u.role='admin' THEN -1 ELSE 100 END
FROM users u WHERE u.id=p.user_id AND p.image_limit=20;
UPDATE image_policies SET attempts_limit=300 WHERE attempts_limit=60;
