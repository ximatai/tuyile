ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN temporary_password_expires_at timestamptz;
ALTER TABLE users ADD CONSTRAINT temporary_password_state CHECK (
 (NOT must_change_password AND temporary_password_expires_at IS NULL) OR
 (must_change_password AND password_hash IS NOT NULL AND temporary_password_expires_at IS NOT NULL)
);
