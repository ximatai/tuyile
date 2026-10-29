ALTER TABLE planning_jobs ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE planning_policies ADD COLUMN queue_limit integer NOT NULL DEFAULT 10 CHECK(queue_limit BETWEEN 1 AND 100);
CREATE TABLE planning_settings (
 id integer PRIMARY KEY CHECK(id=1), concurrency integer NOT NULL DEFAULT 2 CHECK(concurrency BETWEEN 1 AND 16),
 queue_limit integer NOT NULL DEFAULT 64 CHECK(queue_limit BETWEEN 1 AND 1000)
);
INSERT INTO planning_settings(id) VALUES(1);
CREATE TABLE administration_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id), target_id uuid REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('execution-settings','planning-policy')), values jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW planning_quota_reconciliation AS
WITH jobs AS (SELECT user_id,day,count(*) FILTER(WHERE charged)::integer used,count(*) FILTER(WHERE NOT charged AND state IN ('queued','running'))::integer held FROM planning_jobs GROUP BY user_id,day)
SELECT coalesce(d.user_id,j.user_id) user_id,coalesce(d.day,j.day) AS day,coalesce(d.used,0) used,coalesce(d.held,0) held,coalesce(j.used,0) job_used,coalesce(j.held,0) job_held
FROM planning_days d FULL JOIN jobs j USING(user_id,day);
