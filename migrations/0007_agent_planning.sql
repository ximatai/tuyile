CREATE TABLE planning_policies (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 daily_limit integer NOT NULL DEFAULT 50 CHECK(daily_limit BETWEEN 0 AND 10000),
 concurrency integer NOT NULL DEFAULT 1 CHECK(concurrency BETWEEN 1 AND 8)
);
CREATE TABLE planning_days (
 user_id uuid NOT NULL REFERENCES users(id), day date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK(used>=0), held integer NOT NULL DEFAULT 0 CHECK(held>=0),
 PRIMARY KEY(user_id,day)
);
CREATE TABLE planning_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id), execution_version integer NOT NULL,
 request_key uuid NOT NULL, input_hash text NOT NULL, input jsonb NOT NULL, messages jsonb NOT NULL,
 provider_id uuid NOT NULL REFERENCES planning_provider_versions(id), skill_id uuid REFERENCES skill_versions(id),
 day date NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
 charged boolean NOT NULL DEFAULT false, cancel_requested boolean NOT NULL DEFAULT false,
 remaining_tokens integer NOT NULL CHECK(remaining_tokens>=0), calls integer NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 3),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL, finished_at timestamptz,
 UNIQUE(workspace_id,id), UNIQUE(project_id,request_key),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
CREATE INDEX planning_jobs_queue ON planning_jobs(created_at,id) WHERE state='queued';
CREATE TABLE agent_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, job_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), request_key uuid NOT NULL, input_hash text NOT NULL,
 document jsonb NOT NULL, confirmed_at timestamptz, started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,version), UNIQUE(job_id,request_key), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES planning_jobs(workspace_id,id)
);
CREATE TABLE agent_references (
 workspace_id uuid NOT NULL, job_id uuid NOT NULL, asset_id uuid NOT NULL,
 PRIMARY KEY(job_id,asset_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES planning_jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
CREATE INDEX agent_references_asset ON agent_references(asset_id);
CREATE TABLE planning_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES planning_jobs(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3), requested_tokens integer NOT NULL CHECK(requested_tokens>0),
 state text NOT NULL CHECK(state IN ('dispatched','received','rejected','unknown')),
 input_tokens integer CHECK(input_tokens>=0), output_tokens integer CHECK(output_tokens>=0),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,ordinal)
);
ALTER TABLE image_tasks ADD COLUMN agent_plan_id uuid, ADD COLUMN step_index integer,
 ADD COLUMN depends_on uuid, ADD CONSTRAINT image_tasks_agent_plan_fk
 FOREIGN KEY(workspace_id,agent_plan_id) REFERENCES agent_plans(workspace_id,id),
 ADD CONSTRAINT image_tasks_dependency_fk FOREIGN KEY(workspace_id,depends_on) REFERENCES image_tasks(workspace_id,id),
 ADD CONSTRAINT image_tasks_plan_step CHECK((agent_plan_id IS NULL AND step_index IS NULL AND depends_on IS NULL) OR (agent_plan_id IS NOT NULL AND step_index>=0));
CREATE UNIQUE INDEX image_tasks_plan_step ON image_tasks(agent_plan_id,step_index) WHERE agent_plan_id IS NOT NULL;
