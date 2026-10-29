import { spawn } from "node:child_process";
import assert from "node:assert/strict";
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
const api = start("dist/api/main.js", "API_READY"),
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
  api.child.kill("SIGTERM");
  worker.child.kill("SIGTERM");
  assert.equal(await api.exited, 0);
  assert.equal(await worker.exited, 0);
  console.log(
    "Built API/static assets/Worker readiness and graceful shutdown passed",
  );
} finally {
  api.child.kill("SIGTERM");
  worker.child.kill("SIGTERM");
}
