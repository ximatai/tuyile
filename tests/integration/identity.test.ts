import { finishTemporaryPassword } from "../test-database.js";
import { spawn } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import type { Principal } from "@tuyile/contracts";
import { assertSchema, createDatabase } from "@tuyile/infrastructure";
import { createApp } from "../../apps/api/src/app.js";
import { migrate } from "../../scripts/migrate.js";
import { resetDatabase, testUrls, testPassword } from "../test-database.js";
let db: Awaited<ReturnType<typeof resetDatabase>>;
const origin = "http://127.0.0.1:5180";
beforeEach(async () => {
  db = await resetDatabase();
});
afterEach(async () => {
  await db?.pool.end();
});
async function login(name = "admin") {
  const s = await db.service.login(name, testPassword);
  return { ...s, view: await db.service.authenticate(s.token) };
}
async function member(p: Principal, name: string) {
  const l = await db.service.createUser(p, name);
  await finishTemporaryPassword(db.service, l, testPassword);
  return login(name);
}
describe("real PostgreSQL identity and HTTP boundaries", () => {
  it("bootstraps once, rejects runtime DDL and verifies migration replay", async () => {
    await expect(
      db.service.bootstrap("other", testPassword),
    ).rejects.toMatchObject({ code: "ALREADY_INITIALIZED" });
    await assertSchema(db.pool);
    await expect(
      db.pool.query("CREATE TABLE forbidden(id integer)"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(migrate(testUrls().runtime)).rejects.toThrow(
      "MIGRATION_ROLE_REQUIRED",
    );
    await migrate(testUrls().owner);
    const { pool } = createDatabase(testUrls().owner);
    try {
      await expect(assertSchema(pool)).rejects.toThrow(
        "RUNTIME_ROLE_TOO_PRIVILEGED",
      );
    } finally {
      await pool.end();
    }
  });
  it("recovers the administrator through private CLI output without leaking or overwriting", async () => {
    const old = await login();
    const file = `.codex-temp/recovery-test-${randomUUID()}.json`;
    async function cli() {
      return new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "scripts/admin-recover.ts"],
          {
            env: {
              ...process.env,
              ADMIN_USERNAME: "admin",
              ADMIN_RECOVERY_FILE: file,
            },
          },
        );
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("exit", (code) => resolve({ code, out }));
      });
    }
    try {
      const run = await cli();
      expect(run.code).toBe(0);
      const content = await readFile(file, "utf8");
      expect(run.out).not.toContain("#reset=");
      expect(run.out).not.toContain(testPassword);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await expect(db.service.authenticate(old.token)).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        db.service.login("admin", testPassword),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
      expect((await cli()).code).toBe(1);
      expect(await readFile(file, "utf8")).toBe(content);
      const token = new URL(JSON.parse(content).url).hash.split("=")[1];
      await db.service.redeem(token, testPassword, "reset");
      expect((await login()).view.user.role).toBe("admin");
    } finally {
      await unlink(file).catch(() => {});
    }
  });
  it("allows only one initial password change; replaced or expired temporary passwords fail", async () => {
    const a = await login();
    const link = await db.service.createUser(a.view.user, "alice");
    expect(link).not.toHaveProperty("token");
    expect(link.user.mustChangePassword).toBe(true);
    const initialHash = (
      await db.pool.query("SELECT password_hash FROM users WHERE id=$1", [
        link.user.id,
      ])
    ).rows[0].password_hash;
    expect(initialHash).toMatch(/^scrypt\$/);
    expect(initialHash).not.toContain(link.temporaryPassword);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM password_tokens WHERE user_id=$1",
          [link.user.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const initial = await db.service.login("alice", link.temporaryPassword);
    const view = await db.service.authenticate(initial.token);
    await expect(db.service.projects(view.user)).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    const results = await Promise.allSettled([
      db.service.changePassword(
        view.user,
        link.temporaryPassword,
        testPassword,
      ),
      db.service.changePassword(
        view.user,
        link.temporaryPassword,
        testPassword,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const old = await db.service.reset(a.view.user, link.user.id);
    const latest = await db.service.reset(a.view.user, link.user.id);
    expect(latest.temporaryPassword).not.toBe(old.temporaryPassword);
    await expect(
      db.service.login("alice", old.temporaryPassword),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const { pool } = createDatabase(testUrls().owner);
    try {
      await pool.query(
        "UPDATE tuyile.users SET temporary_password_expires_at=now()-interval '1 second' WHERE id=$1",
        [link.user.id],
      );
    } finally {
      await pool.end();
    }
    await expect(
      db.service.login("alice", latest.temporaryPassword),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("restricts temporary-password sessions, blocks self-reset and clears the restriction after changing password", async () => {
    const admin = await login();
    const alice = await member(admin.view.user, "alice");
    await expect(
      db.service.reset(admin.view.user, admin.view.user.id),
    ).rejects.toMatchObject({ code: "CANNOT_RESET_SELF" });
    expect(
      (await db.service.authenticate(admin.token)).user.mustChangePassword,
    ).toBe(false);
    const reset = await db.service.reset(admin.view.user, alice.view.user.id);
    expect(reset.temporaryPassword).toMatch(/^[a-f0-9]{24}$/);
    const stored = (
      await db.pool.query(
        "SELECT password_hash,must_change_password FROM users WHERE id=$1",
        [alice.view.user.id],
      )
    ).rows[0];
    expect(stored.password_hash).not.toContain(reset.temporaryPassword);
    expect(stored.must_change_password).toBe(true);
    const session = await db.service.login("alice", reset.temporaryPassword);
    const view = await db.service.authenticate(session.token);
    const app = createApp(
      db.service,
      db.store,
      { origin, production: false },
      async () => {},
    );
    const headers = {
      Cookie: `tuyile_session=${session.token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    };
    for (const path of [
      "/api/projects",
      "/api/admin/users",
      "/api/images/tasks",
      "/api/library/assets",
    ]) {
      const response = await app.request(path, { headers });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe(
        "PASSWORD_CHANGE_REQUIRED",
      );
    }
    expect((await app.request("/api/auth/me", { headers })).status).toBe(200);
    await expect(db.service.projects(view.user)).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    await expect(
      db.service.changePassword(
        view.user,
        reset.temporaryPassword,
        reset.temporaryPassword,
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_UNCHANGED" });
    const response = await app.request("/api/auth/password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: reset.temporaryPassword,
        password: testPassword,
      }),
    });
    expect(response.status).toBe(200);
    await expect(db.service.authenticate(session.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      db.service.login("alice", reset.temporaryPassword),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await login("alice")).view.user.mustChangePassword).toBe(false);
    expect(
      (
        await db.pool.query(
          "SELECT temporary_password_expires_at FROM users WHERE id=$1",
          [alice.view.user.id],
        )
      ).rows[0].temporary_password_expires_at,
    ).toBeNull();
  });
  it("logs out only current device; reset/disable/password change revoke all and do not reactivate old sessions", async () => {
    const a = await login(),
      b = await member(a.view.user, "alice"),
      c = await login("alice");
    await db.service.logout(b.token);
    await expect(db.service.authenticate(b.token)).rejects.toMatchObject({
      status: 401,
    });
    expect((await db.service.authenticate(c.token)).user.username).toBe(
      "alice",
    );
    const originalVersion = c.view.user.executionVersion;
    await db.service.enable(a.view.user, c.view.user.id, false);
    await expect(db.service.authenticate(c.token)).rejects.toMatchObject({
      status: 401,
    });
    await db.service.enable(a.view.user, c.view.user.id, true);
    await expect(db.service.authenticate(c.token)).rejects.toMatchObject({
      status: 401,
    });
    const d = await login("alice");
    expect(d.view.user.executionVersion).toBeGreaterThan(originalVersion);
    const reset = await db.service.reset(a.view.user, d.view.user.id);
    await expect(db.service.authenticate(d.token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(db.service.login("alice", testPassword)).rejects.toMatchObject(
      { code: "INVALID_CREDENTIALS" },
    );
    const temporary = await db.service.login("alice", reset.temporaryPassword);
    const temporaryView = await db.service.authenticate(temporary.token);
    expect(temporaryView.user.mustChangePassword).toBe(true);
    await db.service.changePassword(
      temporaryView.user,
      reset.temporaryPassword,
      testPassword,
    );
    const fresh = await login("alice");
    await db.service.changePassword(
      fresh.view.user,
      testPassword,
      "New-synthetic-password-2026",
    );
    await expect(db.service.authenticate(fresh.token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(db.service.login("alice", testPassword)).rejects.toMatchObject(
      { code: "INVALID_CREDENTIALS" },
    );
  });
  it("enforces anonymous/admin/member/project scope, cookie and CSRF protection", async () => {
    const app = createApp(
      db.service,
      db.store,
      { origin, production: false },
      () => assertSchema(db.pool),
    );
    expect((await app.request("/api/projects")).status).toBe(401);
    const badOrigin = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "admin", password: testPassword }),
    });
    expect(badOrigin.status).toBe(403);
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: testPassword }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie")!.split(";")[0],
      view = await response.json();
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    };
    expect(
      (
        await app.request("/api/projects", {
          method: "POST",
          headers,
          body: '{"name":"forbidden"}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/projects", {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": "é".repeat(64) },
          body: '{"name":"forbidden"}',
        })
      ).status,
    ).toBe(403);
    const p = await db.service.createProject(view.user, "Admin private");
    const b = await member(view.user, "alice");
    const memberHeaders = {
      Cookie: `tuyile_session=${b.token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": b.csrfToken,
    };
    expect(
      (await app.request("/api/admin/users", { headers: memberHeaders }))
        .status,
    ).toBe(403);
    expect(
      (await app.request(`/api/projects/${p.id}`, { headers: memberHeaders }))
        .status,
    ).toBe(404);
    const owned = await db.service.createProject(b.view.user, "Alice private");
    await expect(db.service.project(view.user, owned.id)).rejects.toMatchObject(
      { status: 404 },
    );
    expect((await db.service.projects(b.view.user)).map((x) => x.id)).toEqual([
      owned.id,
    ]);
    const malicious = await app.request("/api/projects", {
      method: "POST",
      headers: { ...headers, "X-CSRF-Token": view.csrfToken },
      body: JSON.stringify({
        name: "A safe project",
        workspaceId: b.view.user.workspaceId,
      }),
    });
    expect(malicious.status).toBe(201);
    expect((await malicious.json()).workspaceId).toBe(view.user.workspaceId);
    expect(JSON.stringify(await db.service.users(view.user))).not.toMatch(
      /passwordHash|csrfToken|token_hash/,
    );
  });
  it("enforces HTTPS cookie flags, JSON MIME, session expiry and readiness failure", async () => {
    const secureOrigin = "https://tuyile.example";
    const app = createApp(
      db.service,
      db.store,
      { origin: secureOrigin, production: true },
      () => assertSchema(db.pool),
    );
    const headers = {
      Origin: secureOrigin,
      "Content-Type": "application/json",
    };
    expect(
      (
        await app.request("/api/auth/login", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/jsonp" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "admin", password: testPassword }),
    });
    expect(response.headers.get("set-cookie")).toContain("Secure");
    const a = await login(),
      b = await member(a.view.user, "alice");
    expect(
      (
        await app.request("/api/admin/users/not-a-uuid/reset", {
          method: "POST",
          headers: {
            ...headers,
            Cookie: `tuyile_session=${b.token}`,
            "X-CSRF-Token": b.csrfToken,
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const { pool } = createDatabase(testUrls().owner);
    try {
      await pool.query(
        "UPDATE tuyile.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [b.view.user.id],
      );
    } finally {
      await pool.end();
    }
    await expect(db.service.authenticate(b.token)).rejects.toMatchObject({
      status: 401,
    });
    const unhealthy = createApp(
      db.service,
      db.store,
      { origin, production: false },
      async () => {
        throw new Error("private-detail");
      },
    );
    const ready = await unhealthy.request("/api/ready");
    expect(ready.status).toBe(503);
    expect(await ready.text()).not.toContain("private-detail");
  });
  it("paginates projects and accounts without hiding older records or crossing workspaces", async () => {
    const a = await login();
    const app = createApp(
      db.service,
      db.store,
      { origin, production: false },
      () => assertSchema(db.pool),
    );
    await db.pool.query(
      "INSERT INTO tuyile.projects(workspace_id,name) SELECT $1,'Project '||n FROM generate_series(1,55) n",
      [a.view.user.workspaceId],
    );
    const headers = { Cookie: `tuyile_session=${a.token}` };
    const first = await (
      await app.request("/api/projects", { headers })
    ).json();
    const second = await (
      await app.request("/api/projects?offset=50", { headers })
    ).json();
    expect(first.projects).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.projects).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.projects, ...second.projects].map((x) => x.id)).size,
    ).toBe(55);
    for (let n = 0; n < 54; n++)
      await db.service.createUser(a.view.user, `member${n}`);
    const users = await (
      await app.request("/api/admin/users", { headers })
    ).json();
    const rest = await (
      await app.request("/api/admin/users?offset=50", { headers })
    ).json();
    expect(users.users).toHaveLength(50);
    expect(rest.users).toHaveLength(5);
    expect(new Set([...users.users, ...rest.users].map((x) => x.id)).size).toBe(
      55,
    );
    expect(
      (await app.request("/api/projects?offset=-1", { headers })).status,
    ).toBe(400);
  });
  it("keeps workspace membership and project FK ownership constrained", async () => {
    const a = await login(),
      b = await member(a.view.user, "alice");
    await expect(
      db.pool.query(
        "INSERT INTO workspace_members(workspace_id,user_id) VALUES($1,$2)",
        [a.view.user.workspaceId, b.view.user.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(
        "INSERT INTO projects(workspace_id,name) VALUES(gen_random_uuid(),$1)",
        ["invalid"],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("rate limits parallel credential attempts without revealing missing account", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        db.service.login("missing", testPassword),
      ),
    );
    expect(
      results.filter(
        (r) => r.status === "rejected" && r.reason.code === "RATE_LIMITED",
      ),
    ).toHaveLength(2);
    expect(
      results.filter(
        (r) =>
          r.status === "rejected" && r.reason.code === "INVALID_CREDENTIALS",
      ),
    ).toHaveLength(10);
  });
});
