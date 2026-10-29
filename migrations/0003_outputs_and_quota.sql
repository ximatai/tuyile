-- Keep historical manual decisions, but reverse charges unsupported by local outputs.
CREATE TABLE image_quota_corrections (
 task_id uuid PRIMARY KEY REFERENCES image_tasks(id),
 previous_used integer NOT NULL, corrected_used integer NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO image_quota_corrections(task_id,previous_used,corrected_used,reason)
SELECT t.id,t.used,t.used-a.confirmed,'M2_MANUAL_CHARGE_WITHOUT_LOCAL_OUTPUT'
FROM image_tasks t JOIN image_audit a ON a.task_id=t.id WHERE a.confirmed>0;
UPDATE image_days d SET used=d.used-x.amount
FROM (SELECT t.user_id,t.day,sum(c.previous_used-c.corrected_used)::integer amount
 FROM image_quota_corrections c JOIN image_tasks t ON t.id=c.task_id GROUP BY t.user_id,t.day) x
WHERE d.user_id=x.user_id AND d.day=x.day;
UPDATE image_tasks t SET used=c.corrected_used FROM image_quota_corrections c WHERE t.id=c.task_id;

CREATE TABLE image_outputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 task_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0), asset_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,ordinal), UNIQUE(workspace_id,id), UNIQUE(asset_id),
 FOREIGN KEY(workspace_id,task_id) REFERENCES image_tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
INSERT INTO image_outputs(workspace_id,task_id,ordinal,asset_id,created_at)
SELECT workspace_id,task_id,ordinal,id,created_at FROM image_assets
WHERE task_id IS NOT NULL AND hash IS NOT NULL AND state IN ('ready','deleting','deleted');

CREATE TABLE image_quota_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 task_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id), day date NOT NULL,
 source text NOT NULL, kind text NOT NULL CHECK(kind IN ('opening','reserve','consume','release')),
 used_delta integer NOT NULL, held_delta integer NOT NULL,
 output_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,source),
 FOREIGN KEY(workspace_id,task_id) REFERENCES image_tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,output_id) REFERENCES image_outputs(workspace_id,id),
 CHECK ((kind='opening' AND used_delta>=0 AND held_delta>=0 AND output_id IS NULL)
 OR (kind='reserve' AND used_delta=0 AND held_delta>0 AND output_id IS NULL)
 OR (kind='consume' AND used_delta=1 AND held_delta=-1 AND output_id IS NOT NULL)
 OR (kind='release' AND used_delta=0 AND held_delta<0 AND output_id IS NULL))
);
CREATE UNIQUE INDEX image_output_consumed_once ON image_quota_entries(output_id) WHERE output_id IS NOT NULL;
CREATE INDEX image_quota_entries_day ON image_quota_entries(user_id,day);
-- Opening balances are explicit: do not invent unavailable historical events.
INSERT INTO image_quota_entries(workspace_id,task_id,user_id,day,source,kind,used_delta,held_delta)
SELECT workspace_id,id,user_id,day,'migration-3-opening','opening',used,held FROM image_tasks;
CREATE VIEW image_quota_reconciliation AS
WITH entries AS (
 SELECT user_id,day,sum(used_delta)::integer used,sum(held_delta)::integer held
 FROM image_quota_entries GROUP BY user_id,day
)
SELECT d.user_id,d.day,d.used,d.held,coalesce(e.used,0) ledger_used,coalesce(e.held,0) ledger_held
FROM image_days d LEFT JOIN entries e USING(user_id,day);
-- Abort rather than silently import an inconsistent old quota/output relationship.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM image_tasks t WHERE t.used<>(SELECT count(*) FROM image_outputs o WHERE o.task_id=t.id))
 THEN RAISE EXCEPTION 'OUTPUT_QUOTA_MIGRATION_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM image_quota_reconciliation WHERE used<>ledger_used OR held<>ledger_held)
 THEN RAISE EXCEPTION 'QUOTA_MIGRATION_MISMATCH'; END IF;
END $$;
