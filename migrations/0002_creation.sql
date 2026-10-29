CREATE TABLE image_policies (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 image_limit integer NOT NULL DEFAULT 20 CHECK(image_limit>=0),
 attempts_limit integer NOT NULL DEFAULT 60 CHECK(attempts_limit>=0),
 storage_limit bigint NOT NULL DEFAULT 2147483648 CHECK(storage_limit>=0),
 storage_used bigint NOT NULL DEFAULT 0 CHECK(storage_used>=0),
 storage_reserved bigint NOT NULL DEFAULT 0 CHECK(storage_reserved>=0),
 concurrency integer NOT NULL DEFAULT 1 CHECK(concurrency BETWEEN 1 AND 8),
 queue_limit integer NOT NULL DEFAULT 10 CHECK(queue_limit BETWEEN 1 AND 100),
 max_edge integer NOT NULL DEFAULT 2048 CHECK(max_edge BETWEEN 256 AND 8192),
 max_pixels integer NOT NULL DEFAULT 4194304 CHECK(max_pixels BETWEEN 65536 AND 32000000),
 max_count integer NOT NULL DEFAULT 4 CHECK(max_count BETWEEN 1 AND 16),
 max_quality text NOT NULL DEFAULT 'high' CHECK(max_quality IN ('low','medium','high')),
 allowed_models jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE image_settings (
 id integer PRIMARY KEY CHECK(id=1), concurrency integer NOT NULL DEFAULT 2 CHECK(concurrency BETWEEN 1 AND 16),
 queue_limit integer NOT NULL DEFAULT 64 CHECK(queue_limit BETWEEN 1 AND 1000)
);
INSERT INTO image_settings(id) VALUES(1);
CREATE TABLE image_provider_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mode text NOT NULL CHECK(mode IN ('openai','fake')),
 base_url text NOT NULL, models jsonb NOT NULL, secret_cipher text NOT NULL,
 active boolean NOT NULL DEFAULT true, revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_image_provider ON image_provider_versions(active) WHERE active;
CREATE TABLE image_days (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK(used>=0), held integer NOT NULL DEFAULT 0 CHECK(held>=0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), PRIMARY KEY(user_id,day)
);
CREATE TABLE image_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id), execution_version integer NOT NULL,
 request_key uuid NOT NULL, input_hash text NOT NULL, input jsonb NOT NULL, policy jsonb NOT NULL,
 provider_id uuid NOT NULL REFERENCES image_provider_versions(id), day date NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','partial','failed','cancelled')),
 cancel_requested boolean NOT NULL DEFAULT false, error_code text,
 held integer NOT NULL CHECK(held>=0), used integer NOT NULL DEFAULT 0 CHECK(used>=0),
 pending_review boolean NOT NULL DEFAULT false, storage_remaining bigint NOT NULL CHECK(storage_remaining>=0),
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 deadline timestamptz NOT NULL, resolved_at timestamptz,
 UNIQUE(workspace_id,project_id,request_key), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
CREATE INDEX queued_image_tasks ON image_tasks(created_at,id) WHERE state='queued';
CREATE INDEX user_image_tasks ON image_tasks(user_id,created_at DESC,id);
CREATE TABLE image_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, task_id uuid NOT NULL,
 ordinal integer NOT NULL, retry integer NOT NULL CHECK(retry IN (0,1)),
 state text NOT NULL CHECK(state IN ('dispatched','received','succeeded','rejected','unknown','resolved')),
 http_status integer, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,ordinal,retry), FOREIGN KEY(workspace_id,task_id) REFERENCES image_tasks(workspace_id,id)
);
CREATE TABLE image_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES users(id),
 task_id uuid, ordinal integer, state text NOT NULL CHECK(state IN ('staging','ready','deleting','deleted')),
 mime text, width integer, height integer, bytes bigint NOT NULL DEFAULT 0, preview_bytes bigint NOT NULL DEFAULT 0,
 hash text, file_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(task_id,ordinal),
 FOREIGN KEY(workspace_id,task_id) REFERENCES image_tasks(workspace_id,id)
);
CREATE TABLE image_references (
 workspace_id uuid NOT NULL, task_id uuid NOT NULL, asset_id uuid NOT NULL,
 PRIMARY KEY(task_id,asset_id), FOREIGN KEY(workspace_id,task_id) REFERENCES image_tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES image_assets(workspace_id,id)
);
CREATE TABLE image_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id), task_id uuid NOT NULL REFERENCES image_tasks(id),
 confirmed integer NOT NULL CHECK(confirmed>=0), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id)
);
