import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  AppError,
  type Repository,
  type Store,
  type UserRecord,
  type SessionRecord,
} from "@tuyile/core";
import type { Project, Principal, UserView } from "@tuyile/contracts";
export function createDatabase(url: string) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    options:
      "-c search_path=tuyile,pg_catalog -c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000",
  });
  pool.on("error", () => console.error("DATABASE_CONNECTION_ERROR"));
  return { pool, orm: drizzle(pool) };
}
const user = (row: any): UserRecord => ({
  id: row.id,
  username: row.username,
  role: row.role,
  enabled: row.enabled,
  activated: !!row.password_hash,
  passwordHash: row.password_hash,
  mustChangePassword: row.must_change_password,
  temporaryPasswordExpiresAt: row.temporary_password_expires_at,
  executionVersion: row.execution_version,
});
const project = (row: any): Project => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
});
class PgRepository implements Repository {
  constructor(private c: pg.PoolClient) {}
  async userByName(name: string) {
    const { rows } = await this.c.query(
      "SELECT * FROM users WHERE username=$1",
      [name],
    );
    return rows[0] ? user(rows[0]) : null;
  }
  async userById(id: string, lock = false) {
    const { rows } = await this.c.query(
      `SELECT * FROM users WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    return rows[0] ? user(rows[0]) : null;
  }
  async bootstrapLock() {
    await this.c.query("SELECT pg_advisory_xact_lock(72110401)");
  }
  async userCount() {
    return Number(
      (await this.c.query("SELECT count(*) AS n FROM users")).rows[0].n,
    );
  }
  async createUser(
    name: string,
    role: "admin" | "member",
    hash: string | null,
  ) {
    const { rows } = await this.c.query(
      "INSERT INTO users(username,role,password_hash) VALUES($1,$2,$3) RETURNING *",
      [name, role, hash],
    );
    const u = user(rows[0]);
    const ws = (
      await this.c.query(
        "INSERT INTO workspaces(owner_id) VALUES($1) RETURNING id",
        [u.id],
      )
    ).rows[0];
    await this.c.query(
      "INSERT INTO workspace_members(workspace_id,user_id) VALUES($1,$2)",
      [ws.id, u.id],
    );
    return u;
  }
  async setPassword(id: string, hash: string | null, temporaryUntil?: Date) {
    await this.c.query(
      "UPDATE users SET password_hash=$2, must_change_password=$3, temporary_password_expires_at=$4 WHERE id=$1",
      [id, hash, !!temporaryUntil, temporaryUntil ?? null],
    );
  }
  async setEnabled(id: string, enabled: boolean) {
    await this.c.query("UPDATE users SET enabled=$2 WHERE id=$1", [
      id,
      enabled,
    ]);
  }
  async revokeUser(id: string) {
    await this.c.query(
      "UPDATE users SET execution_version=execution_version+1 WHERE id=$1",
      [id],
    );
    await this.c.query("DELETE FROM sessions WHERE user_id=$1", [id]);
  }
  async listUsers(offset = 0, search = ""): Promise<UserView[]> {
    return (
      await this.c.query(
        `SELECT id,username,role,enabled,password_hash IS NOT NULL AS activated, must_change_password AS "mustChangePassword" FROM users WHERE ($2='' OR strpos(username,$2)>0) ORDER BY created_at DESC,id LIMIT 51 OFFSET $1`,
        [offset, search],
      )
    ).rows;
  }
  async createToken(
    userId: string,
    kind: "activate" | "reset",
    hash: string,
    expiresAt: Date,
  ) {
    await this.c.query(
      "INSERT INTO password_tokens(user_id,kind,token_hash,expires_at) VALUES($1,$2,$3,$4)",
      [userId, kind, hash, expiresAt],
    );
  }
  async tokenByHash(hash: string) {
    const r = (
      await this.c.query(
        "SELECT user_id,kind,expires_at FROM password_tokens WHERE token_hash=$1",
        [hash],
      )
    ).rows[0];
    return r
      ? { userId: r.user_id, kind: r.kind, expiresAt: r.expires_at }
      : null;
  }
  async deleteTokens(id: string) {
    await this.c.query("DELETE FROM password_tokens WHERE user_id=$1", [id]);
  }
  async createSession(s: SessionRecord) {
    await this.c.query(
      "DELETE FROM sessions WHERE user_id=$1 AND expires_at < now()",
      [s.userId],
    );
    await this.c.query(
      "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)",
      [s.tokenHash, s.userId, s.csrfToken, s.expiresAt],
    );
  }
  async sessionByHash(hash: string) {
    const r = (
      await this.c.query(
        "SELECT u.*,w.id AS workspace_id,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.owner_id=u.id JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id WHERE s.token_hash=$1",
        [hash],
      )
    ).rows[0];
    if (!r) return null;
    const { passwordHash: _, temporaryPasswordExpiresAt: __, ...u } = user(r);
    return {
      principal: { ...u, workspaceId: r.workspace_id } as Principal,
      session: {
        tokenHash: hash,
        userId: r.id,
        csrfToken: r.csrf_token,
        expiresAt: r.expires_at,
      },
    };
  }
  async deleteSession(hash: string) {
    await this.c.query("DELETE FROM sessions WHERE token_hash=$1", [hash]);
  }
  async consumeLoginBudget(key: string, limit = 10) {
    await this.c.query(
      "DELETE FROM login_limits WHERE started_at < now()-interval '1 day'",
    );
    const r = await this.c.query(
      `INSERT INTO login_limits(key,attempts,started_at) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.started_at < now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END, started_at=CASE WHEN login_limits.started_at < now()-interval '15 minutes' THEN now() ELSE login_limits.started_at END RETURNING attempts`,
      [key],
    );
    return r.rows[0].attempts <= limit;
  }
  async listProjects(ws: string, offset = 0) {
    return (
      await this.c.query(
        "SELECT * FROM projects WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 51 OFFSET $2",
        [ws, offset],
      )
    ).rows.map(project);
  }
  async projectById(ws: string, id: string) {
    const { rows } = await this.c.query(
      "SELECT * FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
      [ws, id],
    );
    return rows[0] ? project(rows[0]) : null;
  }
  async createProject(ws: string, name: string) {
    return project(
      (
        await this.c.query(
          "INSERT INTO projects(workspace_id,name) VALUES($1,$2) RETURNING *",
          [ws, name],
        )
      ).rows[0],
    );
  }
}
export class PgStore implements Store {
  constructor(public pool: pg.Pool) {}
  async transaction<T>(work: (r: Repository) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await work(new PgRepository(c));
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      if ((e as any).code === "23505")
        throw new AppError("ALREADY_EXISTS", 409);
      throw e;
    } finally {
      c.release();
    }
  }
}
export async function assertSchema(pool: pg.Pool) {
  const result = await pool.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  if (
    result.rows.length !== 18 ||
    result.rows[0].version !== 1 ||
    result.rows[1].version !== 2 ||
    result.rows[2].version !== 3 ||
    result.rows[3].version !== 4 ||
    result.rows[4].version !== 5 ||
    result.rows[5].version !== 6 ||
    result.rows[6].version !== 7 ||
    result.rows[7].version !== 8 ||
    result.rows[8].version !== 9 ||
    result.rows[9].version !== 10 ||
    result.rows[10].version !== 11 ||
    result.rows[11].version !== 12 ||
    result.rows[12].version !== 13 ||
    result.rows[13].version !== 14 ||
    result.rows[14].version !== 15 ||
    result.rows[15].version !== 16 ||
    result.rows[16].version !== 17 ||
    result.rows[17].version !== 18
  )
    throw new Error("SCHEMA_VERSION_MISMATCH_RUN_MIGRATIONS");
  const r = await pool.query(
    "SELECT rolsuper,rolcreatedb,rolcreaterole,has_schema_privilege(current_user,'tuyile','CREATE') AS can_create FROM pg_roles WHERE rolname=current_user",
  );
  if (
    r.rows[0].rolsuper ||
    r.rows[0].rolcreatedb ||
    r.rows[0].rolcreaterole ||
    r.rows[0].can_create
  )
    throw new Error("RUNTIME_ROLE_TOO_PRIVILEGED");
}
