CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK(username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
  role text NOT NULL CHECK(role IN ('admin','member')),
  enabled boolean NOT NULL DEFAULT true,
  password_hash text,
  execution_version integer NOT NULL DEFAULT 1 CHECK(execution_version>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES users(id),
  UNIQUE(id,owner_id)
);
CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY(workspace_id,user_id),
  FOREIGN KEY(workspace_id,user_id) REFERENCES workspaces(id,owner_id)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE password_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('activate','reset')),
  expires_at timestamptz NOT NULL
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE INDEX projects_workspace ON projects(workspace_id,created_at DESC);
CREATE TABLE login_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL CHECK(attempts>0),
  started_at timestamptz NOT NULL
);
