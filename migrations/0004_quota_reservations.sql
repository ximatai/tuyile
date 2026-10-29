-- One reservation per accepted image order. Task counters remain query projections.
CREATE TABLE image_quota_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL, task_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id), day date NOT NULL,
 kind text NOT NULL DEFAULT 'image' CHECK(kind='image'),
 accepted integer NOT NULL CHECK(accepted>0),
 consumed integer NOT NULL DEFAULT 0 CHECK(consumed>=0),
 held integer NOT NULL CHECK(held>=0), released integer NOT NULL DEFAULT 0 CHECK(released>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,task_id) REFERENCES image_tasks(workspace_id,id),
 CHECK(accepted=consumed+held+released)
);
INSERT INTO image_quota_reservations(workspace_id,task_id,user_id,day,accepted,consumed,held,released,created_at)
SELECT workspace_id,id,user_id,day,(input->>'count')::integer,used,held,(input->>'count')::integer-used-held,created_at
FROM image_tasks;
ALTER TABLE image_quota_entries ADD COLUMN reservation_id uuid;
UPDATE image_quota_entries e SET reservation_id=r.id FROM image_quota_reservations r WHERE r.task_id=e.task_id;
ALTER TABLE image_quota_entries ALTER COLUMN reservation_id SET NOT NULL;
ALTER TABLE image_quota_reservations ADD UNIQUE(workspace_id,task_id,user_id,day,id);
ALTER TABLE image_quota_entries ADD FOREIGN KEY(workspace_id,task_id,user_id,day,reservation_id)
 REFERENCES image_quota_reservations(workspace_id,task_id,user_id,day,id);
CREATE VIEW image_reservation_reconciliation AS
SELECT r.id,r.task_id,r.consumed,r.held,t.used task_used,t.held task_held,
 coalesce(sum(e.used_delta),0)::integer ledger_used,coalesce(sum(e.held_delta),0)::integer ledger_held
FROM image_quota_reservations r JOIN image_tasks t ON t.id=r.task_id
LEFT JOIN image_quota_entries e ON e.reservation_id=r.id
GROUP BY r.id,t.id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM image_reservation_reconciliation WHERE consumed<>task_used OR held<>task_held OR consumed<>ledger_used OR held<>ledger_held)
 THEN RAISE EXCEPTION 'RESERVATION_MIGRATION_MISMATCH'; END IF;
END $$;
