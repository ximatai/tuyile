ALTER TABLE administration_audit DROP CONSTRAINT administration_audit_action_check;
ALTER TABLE administration_audit ADD CONSTRAINT administration_audit_action_check
 CHECK(action IN ('execution-settings','planning-policy','prompt-template-save'));
