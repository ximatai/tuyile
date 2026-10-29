import { chmod, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  createDatabase,
  PgStore,
  security,
  loadConfig,
  assertSchema,
} from "@tuyile/infrastructure";
const config = loadConfig(),
  url = new URL(config.databaseUrl);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55441" ||
  url.pathname !== "/tuyile_docker"
)
  throw new Error("REFUSE_NON_DOCKER_ACCEPTANCE_DATABASE");
const path = ".codex-temp/docker-login.json";
const auth = {
  username: `acceptance_${randomBytes(6).toString("hex")}`,
  password: randomBytes(24).toString("base64url"),
};
const { pool } = createDatabase(config.databaseUrl);
try {
  await assertSchema(pool);
  // Guarded synthetic fixture only: every run gets an independent login budget.
  // Preserve existing acceptance data and the real application's rate limits.
  const hash = await security.hashPassword(auth.password);
  await new PgStore(pool).transaction(async (r) => {
    await r.bootstrapLock();
    await r.createUser(auth.username, "admin", hash);
  });
  await writeFile(path, JSON.stringify(auth), { mode: 0o600 });
  await chmod(path, 0o600);
} finally {
  await pool.end();
}
const base = "http://127.0.0.1:8792",
  headers = { Origin: base, "Content-Type": "application/json" };
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers,
  body: JSON.stringify(auth),
});
assert.equal(login.status, 200);
const session = await login.json(),
  cookie = login.headers.get("set-cookie")!.split(";")[0];
async function request(path: string, data?: unknown) {
  const r = await fetch(`${base}/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { ...headers, Cookie: cookie, "X-CSRF-Token": session.csrfToken },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.ok(r.ok, `HTTP_${r.status}`);
  return r.json();
}
await request("/image-admin/providers", {
  mode: "fake",
  baseUrl: "",
  models: ["test-image"],
  preserveKey: false,
});
const policy = await request(`/image-admin/policies/${session.user.id}`);
await request(`/image-admin/policies/${session.user.id}`, {
  ...policy,
  imageLimit: 100,
  attemptsLimit: 100,
});
const project = await request("/projects", {
    name: "Docker synthetic acceptance",
  }),
  task = await request("/images/tasks", {
    projectId: project.id,
    requestKey: randomUUID(),
    prompt: "Docker synthetic private image",
    model: "test-image",
    width: 256,
    height: 256,
    quality: "medium",
    format: "png",
    count: 1,
    referenceIds: [],
  });
let result: any;
for (let n = 0; n < 100; n++) {
  result = await request(`/images/tasks/${task.id}`);
  if (!["queued", "running"].includes(result.state)) break;
  await new Promise((r) => setTimeout(r, 100));
}
assert.equal(result.state, "succeeded");
assert.equal(result.outputs.length, 1);
assert.equal(result.used, 1);
assert.equal(result.held, 0);
const usage = await request("/images/usage");
assert.ok(usage.used >= 1 && usage.attempts >= 1 && usage.storageUsed > 0);
assert.equal(usage.held, 0);
for (const variant of ["original", "preview", "download"]) {
  const r = await fetch(
    `${base}/api/images/assets/${result.outputs[0].id}/${variant}`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok((await r.arrayBuffer()).byteLength > 0);
}
assert.equal(
  (await fetch(`${base}/api/images/assets/${result.outputs[0].id}/original`))
    .status,
  401,
);
const member = await request("/admin/users", {
    username: `test_${randomBytes(5).toString("hex")}`,
  }),
  password = randomBytes(24).toString("base64url");
assert.equal(
  (
    await fetch(`${base}/api/auth/activate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: member.token, password }),
    })
  ).status,
  200,
);
const memberLogin = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers,
  body: JSON.stringify({ username: member.user.username, password }),
});
assert.equal(memberLogin.status, 200);
const memberCookie = memberLogin.headers.get("set-cookie")!.split(";")[0];
assert.equal(
  (
    await fetch(`${base}/api/images/assets/${result.outputs[0].id}/original`, {
      headers: { Cookie: memberCookie },
    })
  ).status,
  404,
);
assert.equal(
  (
    await fetch(`${base}/api/image-admin/review`, {
      headers: { Cookie: memberCookie },
    })
  ).status,
  403,
);
console.log(
  "Docker API/Worker generation, private originals/previews/downloads, quotas and two-account isolation passed",
);
