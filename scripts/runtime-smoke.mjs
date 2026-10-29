import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const parsed = new URL(process.env.DATABASE_URL ?? "");
if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "55440" ||
  parsed.pathname !== "/tuyile_test"
)
  throw new Error("REFUSE_NON_TEST_DATABASE");
function start(entry, ready) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: "8794",
      APP_ORIGIN: "http://127.0.0.1:8794",
      HOST: "127.0.0.1",
      FAKE_IMAGE_DELAY_MS: "1600",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("RUNTIME_READY_TIMEOUT")),
      15000,
    );
    child.stdout.on("data", (data) => {
      if (String(data).includes(ready)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("RUNTIME_EXITED_BEFORE_READY"));
    });
  });
  return { child, started, exited };
}
let api = start("dist/api/main.js", "API_READY"),
  worker = start("dist/worker/main.js", "WORKER_READY");
try {
  await Promise.all([api.started, worker.started]);
  assert.equal((await fetch("http://127.0.0.1:8794/api/ready")).status, 200);
  const shell = await fetch("http://127.0.0.1:8794/login");
  assert.equal(shell.status, 200);
  assert.match(
    shell.headers.get("content-security-policy"),
    /default-src 'self'/,
  );
  const html = await shell.text();
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.equal((await fetch(`http://127.0.0.1:8794${asset}`)).status, 200);

  const auth = JSON.parse(await readFile(".codex-temp/e2e-auth.json", "utf8"));
  const login = await fetch("http://127.0.0.1:8794/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:8794",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(auth),
  });
  assert.equal(login.status, 200);
  const session = await login.json(),
    cookie = login.headers.get("set-cookie").split(";")[0];
  async function request(path, data) {
    const response = await fetch(`http://127.0.0.1:8794/api${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://127.0.0.1:8794",
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    assert.ok(response.ok, `HTTP_${response.status}`);
    return response.json();
  }
  async function until(read, predicate) {
    for (let i = 0; i < 200; i++) {
      const value = await read();
      if (predicate(value)) return value;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("RUNTIME_TASK_TIMEOUT");
  }
  const second = spawn(process.execPath, ["dist/worker/main.js"], {
    env: process.env,
    stdio: "ignore",
  });
  assert.equal(await new Promise((r) => second.once("exit", r)), 1);
  const project = await request("/projects", {
    name: "Runtime restart synthetic project",
  });
  const input = {
    projectId: project.id,
    requestKey: randomUUID(),
    prompt: "synthetic background restart",
    model: "test-image",
    width: 256,
    height: 256,
    quality: "medium",
    format: "png",
    count: 2,
    referenceIds: [],
  };
  const first = await request("/images/tasks", input);
  await until(
    () => request("/images/usage"),
    (u) => u.attempts > 0,
  );
  api.child.kill("SIGTERM");
  assert.equal(await api.exited, 0);
  api = start("dist/api/main.js", "API_READY");
  await api.started;
  const finished = await until(
    () => request(`/images/tasks/${first.id}`),
    (t) => t.state === "succeeded",
  );
  assert.equal(finished.used, 2);
  assert.equal(finished.outputs.length, 2);
  const preserved = await fetch(
    `http://127.0.0.1:8794/api/images/assets/${finished.outputs[0].id}/original`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(preserved.status, 200);
  assert.equal(preserved.headers.get("cache-control"), "no-store");
  const interrupted = await request("/images/tasks", {
    ...input,
    requestKey: randomUUID(),
  });
  await until(
    () => request("/images/usage"),
    (u) => u.attempts >= 4,
  );
  worker.child.kill("SIGKILL");
  await worker.exited;
  worker = start("dist/worker/main.js", "WORKER_READY");
  await worker.started;
  const partial = await request(`/images/tasks/${interrupted.id}`);
  assert.equal(partial.state, "partial");
  assert.equal(partial.used, 1);
  assert.equal(partial.held, 1);
  assert.equal(partial.pendingReview, true);
  assert.equal((await request("/images/usage")).attempts, 4);
  await request(`/image-admin/review/${interrupted.id}`, {
    confirmed: 0,
    reason: "Synthetic interrupted call verified",
  });
  api.child.kill("SIGTERM");
  worker.child.kill("SIGTERM");
  assert.equal(await api.exited, 0);
  assert.equal(await worker.exited, 0);
  console.log(
    "Built API restart/background images, single Worker, forced interruption, private files and graceful shutdown passed",
  );
} finally {
  api.child.kill("SIGTERM");
  worker.child.kill("SIGTERM");
}
