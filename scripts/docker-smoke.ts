import { execFileSync } from "node:child_process";
import { imageCapabilityDefaults } from "@tuyile/contracts";
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
  capabilities: [
    {
      ...imageCapabilityDefaults("test-image"),
      formats: ["png", "svg"],
      svgAuthor: { mode: "service-default" },
    },
  ],
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
// Exercise the actual compiled Linux SVG subprocess, private preview and API conversion.
const vectorProject = await request("/projects", {
  name: "Docker synthetic SVG acceptance",
});
const vectorTask = await request("/images/tasks", {
  projectId: vectorProject.id,
  requestKey: randomUUID(),
  prompt: "Synthetic SVG",
  model: "test-image",
  width: 1024,
  height: 1024,
  quality: "medium",
  format: "svg",
  count: 1,
  referenceIds: [],
});
let vector: any;
for (let n = 0; n < 100; n++) {
  vector = await request(`/images/tasks/${vectorTask.id}`);
  if (!["queued", "running"].includes(vector.state)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(vector.state, "succeeded");
const vectorId = vector.outputs[0].id;
const vectorPreview = await fetch(
  `${base}/api/images/assets/${vectorId}/original`,
  { headers: { Cookie: cookie } },
);
assert.equal(vectorPreview.headers.get("content-type"), "image/webp");
const vectorOriginal = await fetch(
  `${base}/api/images/assets/${vectorId}/download`,
  { headers: { Cookie: cookie } },
);
assert.match(await vectorOriginal.text(), /<svg/);
const raster = await request(`/images/assets/${vectorId}/raster-copy`, {});
assert.equal(raster.mime, "image/png");
assert.equal(raster.derivedFrom, vectorId);
assert.equal(
  (await request(`/images/assets/${vectorId}/raster-copy`, {})).id,
  raster.id,
);
const limited = execFileSync(
  "docker",
  [
    "compose",
    "--env-file",
    ".env.docker",
    "-p",
    "tuyile-docker",
    "exec",
    "-T",
    "worker",
    "sh",
    "-c",
    `ulimit -c 0
ulimit -d 196608
exec node --jitless --max-old-space-size=64 -e 'try {Buffer.alloc(384*1024*1024).fill(1);process.exitCode=1;} catch {process.stdout.write("NATIVE_LIMIT_OK");}'`,
  ],
  { encoding: "utf8", timeout: 15000 },
);
assert.equal(limited, "NATIVE_LIMIT_OK");
const cpuLimited = execFileSync(
  "docker",
  [
    "compose",
    "--env-file",
    ".env.docker",
    "-p",
    "tuyile-docker",
    "exec",
    "-T",
    "worker",
    "sh",
    "-c",
    `ulimit -c 0
ulimit -d 196608
ulimit -t 1
node --jitless --max-old-space-size=64 -e 'while(true){}' 2>/dev/null
status=$?
[ "$status" -eq 137 ] || [ "$status" -eq 152 ] || exit 1
printf CPU_LIMIT_OK`,
  ],
  { encoding: "utf8", timeout: 15000 },
);
assert.equal(cpuLimited, "CPU_LIMIT_OK");
console.log(
  "Docker SVG generation, safe preview, original export, idempotent raster copy and Linux native/CPU hard limits passed",
);
const member = await request("/admin/users", {
    username: `test_${randomBytes(5).toString("hex")}`,
  }),
  password = randomBytes(24).toString("base64url");
const temporaryLogin = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    username: member.user.username,
    password: member.temporaryPassword,
  }),
});
assert.equal(temporaryLogin.status, 200);
const temporaryView = await temporaryLogin.json();
assert.equal(temporaryView.user.mustChangePassword, true);
const temporaryCookie = temporaryLogin.headers.get("set-cookie")!.split(";")[0];
assert.equal(
  (
    await fetch(`${base}/api/auth/password`, {
      method: "POST",
      headers: {
        ...headers,
        Cookie: temporaryCookie,
        "X-CSRF-Token": temporaryView.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: member.temporaryPassword,
        password,
      }),
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
