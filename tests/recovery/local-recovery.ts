import { finishTemporaryPassword } from "../test-database.js";
import { isIP } from "node:net";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { get as httpsGet } from "node:https";
import { chromium, type Browser } from "@playwright/test";
import {
  AgentService,
  CanvasService,
  CreationService,
  ExtensionService,
  ImageOperations,
  LibraryService,
  PlanningExecutor,
  createToolRegistry,
  Workbench,
} from "@tuyile/core";
import {
  emptyCanvas,
  planningProviderInput,
  planningRequest,
} from "@tuyile/contracts";
import {
  createDatabase,
  assertSchema,
  PgStore,
  security,
  PgCreationStore,
  PgCanvasStore,
  PgLibraryStore,
  PrivateImageFiles,
  ImageWorker,
  PlanningLane,
} from "@tuyile/infrastructure";
import { imageFixture } from "../creation-fixture.js";
import { testUrls, testPassword } from "../test-database.js";

// This drill replaces only the guarded synthetic test server temporarily.
const urls = testUrls();
assert.equal(process.env.PG_PORT, "55440");
assert.equal(process.env.POSTGRES_DB, "tuyile_test");
const run = promisify(execFile);
const sourceProject = "tuyile-test";
const restoreProject = `tuyile-recovery-${randomUUID()}`;
const proxyName = `${restoreProject}-https`;
const compose = (project: string, ...args: string[]) => [
  "compose",
  "--env-file",
  ".env.test",
  "-p",
  project,
  ...args,
];
let interrupted = false,
  cleaning = false;
const interrupt = () => {
  interrupted = true;
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
async function command(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
) {
  if (interrupted && !cleaning) throw new Error("RECOVERY_INTERRUPTED");
  try {
    const result = await run(binary, args, {
      encoding: "buffer",
      env: { ...process.env, ...env },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120000,
    });
    if (interrupted && !cleaning) throw new Error("RECOVERY_INTERRUPTED");
    return result.stdout;
  } catch {
    if (interrupted && !cleaning) throw new Error("RECOVERY_INTERRUPTED");
    throw new Error(`RECOVERY_COMMAND_FAILED_${binary}`);
  }
}
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
type FileProof = { name: string; bytes: number; sha256: string };
async function proof(root: string): Promise<FileProof[]> {
  const result: FileProof[] = [];
  for (const name of (await readdir(root)).sort()) {
    assert.match(name, /^[a-f0-9-]{36}\.(original|preview)$/);
    const path = join(root, name),
      stat = await lstat(path);
    assert(stat.isFile() && !stat.isSymbolicLink());
    const bytes = await readFile(path);
    result.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  return result;
}
async function closeChild(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

await mkdir(".codex-temp", { recursive: true });
const artifact = await mkdtemp(resolve(".codex-temp/m4-recovery-"));
await chmod(artifact, 0o700);
const backupFiles = join(artifact, "backup-files"),
  restoredFiles = join(artifact, "restored-files");
const sourceContainer = String(
  await command("docker", compose(sourceProject, "ps", "-q", "postgres")),
).trim();
assert.match(sourceContainer, /^[a-f0-9]{64}$/);
const sourcePorts = JSON.parse(
  String(
    await command("docker", [
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      sourceContainer,
    ]),
  ),
);
assert.deepEqual(sourcePorts["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "55440" },
]);
assert.equal(
  String(
    await command("docker", [
      "volume",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${restoreProject}`,
      "-q",
    ]),
  ).trim(),
  "",
);
const journal = {
  sourceProject,
  restoreProject,
  sourceContainer,
  proxyName,
  port: 55440,
  database: "tuyile_test",
  apiPid: 0,
  apiPort: 8795,
};
await writeFile(join(artifact, "run.json"), JSON.stringify(journal, null, 2), {
  mode: 0o600,
});
let f: Awaited<ReturnType<typeof imageFixture>> | undefined;
let worker: ImageWorker | undefined, restoredWorker: ImageWorker | undefined;
let sourceClosed = false,
  sourceStopped = false,
  restoreStarted = false;
let restoredPool: ReturnType<typeof createDatabase>["pool"] | undefined;
let api: ChildProcess | undefined, browser: Browser | undefined;
let proxyStarted = false;
let report: Record<string, unknown> | undefined;
try {
  f = await imageFixture();
  const task = await f.creation.submit(f.principal, f.input());
  worker = (await f.worker({ generate: async () => f!.png })).worker;
  const completed = await f.done(task.id);
  assert.equal(completed.state, "succeeded");
  await worker.stop();
  const original = completed.outputs[0];
  const originalBytes = (await f.creation.bytes(f.principal, original.id))
    .bytes;
  const canvas = new CanvasService(new PgCanvasStore(f.pool));
  await canvas.save(f.principal, f.project.id, {
    revision: 0,
    requestKey: randomUUID(),
    placements: [original.outputId],
    document: {
      ...emptyCanvas(),
      nodes: [
        {
          id: randomUUID(),
          kind: "image",
          assetId: original.id,
          label: "Recovery fixture",
          x: 40,
          y: 40,
          width: 256,
          height: 256,
        },
      ],
    },
  });
  await new LibraryService(new PgLibraryStore(f.pool)).saveFavorite(
    f.principal,
    {
      id: randomUUID(),
      title: "Recovery original",
      groupName: "Synthetic",
      assetId: original.id,
    },
  );
  const member = await f.service.createUser(f.principal, "recovery-member");
  await finishTemporaryPassword(f.service, member, testPassword);
  const memberSession = await f.service.login("recovery-member", testPassword);
  const memberPrincipal = (await f.service.authenticate(memberSession.token))
    .user;
  await f.service.createProject(memberPrincipal, "Member recovery project");
  const extensions = new ExtensionService(f.creationStore);
  const encrypted = await extensions.savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "openai",
      baseUrl: "https://synthetic.invalid/v1",
      model: "not-called",
      apiKey: "SYNTHETIC_RECOVERY_KEY",
    }),
  );
  await extensions.savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "fake",
      baseUrl: "",
      model: "recovery-planner",
    }),
  );
  const agent = new AgentService(f.creationStore, f.files);
  const { count, ...request } = f.input({ referenceIds: [original.id] });
  await agent.request(f.principal, planningRequest.parse(request));
  await new PlanningExecutor(agent, {
    complete: async () => ({
      text: JSON.stringify({ message: "Recovery clarification", steps: [] }),
      inputTokens: 1,
      outputTokens: 1,
    }),
  }).execute((await agent.claim([]))!, new AbortController().signal);
  // A crash-era dispatched record must be retained as unknown, never replayed.
  const interruptedTask = await f.creation.submit(f.principal, f.input());
  await f.repo.dispatch((await f.repo.claim([], 0))!, 0, 0);
  const interruptedPlanning = await agent.request(f.principal, {
    ...planningRequest.parse(request),
    requestKey: randomUUID(),
    prompt: "Synthetic interrupted planning",
  });
  await agent.dispatch((await agent.claim([]))!, 256);
  const versions = (
    await f.pool.query(
      "SELECT version,checksum FROM schema_migrations ORDER BY version",
    )
  ).rows;
  const files = await proof(f.root);
  await cp(f.root, backupFiles, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  assert.deepEqual(await proof(backupFiles), files);
  await f.pool.end();
  sourceClosed = true;
  const dump = await command("docker", [
    "exec",
    sourceContainer,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "tuyile_test",
    "-Fc",
  ]);
  await writeFile(join(artifact, "database.dump"), dump, { mode: 0o600 });
  const manifest = {
    format: 1,
    versions,
    files,
    database: { bytes: dump.length, sha256: digest(dump) },
  };
  await writeFile(
    join(artifact, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
  assert.equal(
    digest(await readFile(join(artifact, "database.dump"))),
    manifest.database.sha256,
  );

  sourceStopped = true;
  await command("docker", compose(sourceProject, "stop", "postgres"));
  restoreStarted = true;
  await command(
    "docker",
    compose(restoreProject, "up", "-d", "--wait", "postgres"),
  );
  if (process.env.RECOVERY_TEST_ABORT_AFTER_CLONE === "1")
    process.emit("SIGTERM");
  const restoreContainer = String(
    await command("docker", compose(restoreProject, "ps", "-q", "postgres")),
  ).trim();
  assert.match(restoreContainer, /^[a-f0-9]{64}$/);
  assert.notEqual(restoreContainer, sourceContainer);
  await command("docker", [
    "cp",
    join(artifact, "database.dump"),
    `${restoreContainer}:/tmp/recovery.dump`,
  ]);
  // Roles are initialized by Compose; preserve dump ownership and grants.
  await command("docker", [
    "exec",
    restoreContainer,
    "pg_restore",
    "-U",
    "postgres",
    "-d",
    "tuyile_test",
    "--clean",
    "--if-exists",
    "--exit-on-error",
    "/tmp/recovery.dump",
  ]);
  await cp(backupFiles, restoredFiles, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  assert.deepEqual(await proof(restoredFiles), files);
  const sample = files[0];
  await writeFile(join(restoredFiles, sample.name), Buffer.from("corrupt"));
  assert.notDeepEqual(await proof(restoredFiles), files);
  await rm(join(restoredFiles, sample.name));
  assert.notDeepEqual(await proof(restoredFiles), files);
  await cp(join(backupFiles, sample.name), join(restoredFiles, sample.name));
  assert.deepEqual(await proof(restoredFiles), files);

  restoredPool = createDatabase(urls.runtime).pool;
  await assertSchema(restoredPool);
  assert.deepEqual(
    (
      await restoredPool.query(
        "SELECT version,checksum FROM schema_migrations ORDER BY version",
      )
    ).rows,
    versions,
  );
  const workbench = new Workbench(new PgStore(restoredPool), security);
  const auth = await workbench.login("admin", testPassword),
    principal = (await workbench.authenticate(auth.token)).user;
  assert.equal(principal.id, f.principal.id);
  const store = new PgCreationStore(
    restoredPool,
    process.env.APP_MASTER_KEY!,
    true,
  );
  const images = new PrivateImageFiles(restoredFiles, 0),
    creation = new CreationService(store, images);
  assert.equal(
    digest((await creation.bytes(principal, original.id)).bytes),
    digest(originalBytes),
  );
  assert.equal(
    (
      await new CanvasService(new PgCanvasStore(restoredPool)).load(
        principal,
        f.project.id,
      )
    ).document.nodes[0].assetId,
    original.id,
  );
  assert.equal(
    (
      await new LibraryService(new PgLibraryStore(restoredPool)).favorites(
        principal,
      )
    )[0].assetId,
    original.id,
  );
  assert.equal(
    (await new AgentService(store, images).usage(principal)).used,
    2,
  );
  assert.equal(
    (
      await store.write({ owners: [] }, (r) =>
        r.extensions.planningConfig(encrypted.id),
      )
    ).apiKey,
    "SYNTHETIC_RECOVERY_KEY",
  );
  assert.deepEqual(
    await new CanvasService(new PgCanvasStore(restoredPool)).pending(
      principal,
      f.project.id,
    ),
    [],
  );
  const kinds = (
    await new LibraryService(new PgLibraryStore(restoredPool)).references(
      principal,
      original.id,
    )
  ).map((item) => item.kind);
  for (const kind of ["canvas", "agent", "favorite"])
    assert(kinds.includes(kind as (typeof kinds)[number]));
  await assert.rejects(creation.deleteAsset(principal, original.id), {
    code: "ASSET_REFERENCED",
  });
  let calls = 0,
    planningCalls = 0;
  const restoredAgent = new AgentService(store, images);
  restoredWorker = new ImageWorker(
    restoredPool,
    new ImageOperations(store),
    images,
    {
      generate: async () => {
        calls++;
        return f!.png;
      },
    },
    () => {
      throw new Error("RESTORED_WORKER_FAILED");
    },
    createToolRegistry(),
    new PlanningLane(restoredAgent, {
      complete: async () => {
        planningCalls++;
        return {
          text: JSON.stringify({ message: "Unexpected replay", steps: [] }),
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    }),
  );
  await restoredWorker.start();
  assert.equal(calls, 0);
  assert.equal(planningCalls, 0);
  assert.equal(
    (await restoredAgent.jobs(principal, f.project.id)).find(
      (job) => job.id === interruptedPlanning.id,
    )?.state,
    "failed",
  );
  const old = await creation.task(principal, interruptedTask.id);
  assert.equal(old.state, "failed");
  assert.equal(old.pendingReview, true);
  assert.equal(old.held, 1);
  const fresh = await creation.submit(principal, {
    ...f.input(),
    requestKey: randomUUID(),
  });
  for (let i = 0; i < 200; i++) {
    const task = await creation.task(principal, fresh.id);
    if (task.state === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal((await creation.task(principal, fresh.id)).state, "succeeded");
  assert.equal(calls, 1);
  await restoredWorker.stop();
  for (const view of [
    "image_quota_reconciliation",
    "planning_quota_reconciliation",
  ]) {
    const result: import("pg").QueryResult<{
      used: number | string;
      held: number | string;
      ledger_used?: number | string;
      ledger_held?: number | string;
      job_used?: number | string;
      job_held?: number | string;
    }> = await restoredPool.query(`SELECT * FROM ${view}`);
    for (const row of result.rows) {
      assert.equal(Number(row.used), Number(row.ledger_used ?? row.job_used));
      assert.equal(Number(row.held), Number(row.ledger_held ?? row.job_held));
    }
  }

  await command("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(artifact, "tls.key"),
    "-out",
    join(artifact, "tls.crt"),
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-days",
    "1",
  ]);
  await chmod(join(artifact, "tls.key"), 0o600);
  await command(
    "docker",
    compose(
      restoreProject,
      "-f",
      "compose.yaml",
      "-f",
      "compose.production.yaml",
      "config",
      "--quiet",
      "--no-env-resolution",
    ),
    { PUBLIC_APP_ORIGIN: "https://127.0.0.1:8843" },
  );
  await command("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    `${resolve("deploy/nginx.conf.example")}:/etc/nginx/conf.d/default.conf:ro`,
    "-v",
    `${join(artifact, "tls.crt")}:/etc/nginx/tls/tuyile.crt:ro`,
    "-v",
    `${join(artifact, "tls.key")}:/etc/nginx/tls/tuyile.key:ro`,
    "nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949",
    "nginx",
    "-t",
  ]);

  api = spawn(process.execPath, ["dist/api/main.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "8795",
      APP_ORIGIN: "https://127.0.0.1:8843",
      STORAGE_DIR: restoredFiles,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  journal.apiPid = api.pid ?? 0;
  const apiReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("RESTORED_API_READY_TIMEOUT")),
      15000,
    );
    api!.stdout!.on("data", (data) => {
      if (String(data).includes("API_READY")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    api!.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("RESTORED_API_EXITED"));
    });
    api!.once("error", reject);
  });
  await Promise.all([
    apiReady,
    writeFile(join(artifact, "run.json"), JSON.stringify(journal, null, 2), {
      mode: 0o600,
    }),
  ]);
  const hostAddress = String(
    await command("docker", [
      "run",
      "--rm",
      "nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949",
      "getent",
      "ahostsv4",
      "host.docker.internal",
    ]),
  )
    .trim()
    .split(/\s+/)[0];
  assert.equal(isIP(hostAddress), 4);
  const proxyConfig = (
    await readFile("deploy/nginx.conf.example", "utf8")
  ).replace("http://127.0.0.1:8792", `http://${hostAddress}:8795`);
  assert(proxyConfig.includes(`proxy_pass http://${hostAddress}:8795;`));
  await writeFile(join(artifact, "nginx.conf"), proxyConfig, { mode: 0o600 });
  proxyStarted = true;
  await command("docker", [
    "run",
    "-d",
    "--name",
    proxyName,
    "-p",
    "127.0.0.1:8843:443",
    "-v",
    `${join(artifact, "nginx.conf")}:/etc/nginx/conf.d/default.conf:ro`,
    "-v",
    `${join(artifact, "tls.crt")}:/etc/nginx/tls/tuyile.crt:ro`,
    "-v",
    `${join(artifact, "tls.key")}:/etc/nginx/tls/tuyile.key:ro`,
    "nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949",
  ]);
  let ready = false,
    healthState = "not-started";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !interrupted) {
    ready = await new Promise<boolean>((resolve) => {
      const request = httpsGet(
        {
          hostname: "127.0.0.1",
          port: 8843,
          path: "/api/ready",
          rejectUnauthorized: false,
          timeout: 2000,
        },
        (response) => {
          healthState = `HTTP_${response.statusCode}`;
          response.resume();
          resolve(response.statusCode === 200);
        },
      );
      request.on("error", (error: NodeJS.ErrnoException) => {
        healthState = error.code ?? error.name;
        resolve(false);
      });
      request.on("timeout", () => request.destroy());
    });
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, `LOCAL_NGINX_HTTPS_NOT_READY_${healthState}`);
  browser = await chromium.launch({ channel: "chromium" });
  const adminContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await adminContext.newPage();
  const cspErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|style-src|script-src/i.test(message.text())
    )
      cspErrors.push("CSP_ERROR");
  });
  const loginResponse = await page.goto("https://127.0.0.1:8843/login");
  assert.equal(loginResponse?.status(), 200);
  await page.screenshot({
    path: join(artifact, "https-login.png"),
    animations: "disabled",
  });
  await writeFile(join(artifact, "https-login.html"), await page.content(), {
    mode: 0o600,
  });

  await page
    .getByLabel("账号", { exact: true })
    .fill("admin", { timeout: 10000 })
    .catch(async (error) => {
      await writeFile(
        join(artifact, "https-login-errors.json"),
        JSON.stringify({ cspErrors, pageErrors }, null, 2),
        { mode: 0o600 },
      );
      throw error;
    });
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "我的项目", exact: true }).waitFor();
  assert(
    (await adminContext.cookies()).some(
      (cookie) =>
        cookie.secure && cookie.httpOnly && cookie.sameSite === "Strict",
    ),
  );
  const response = await page.goto(
    `https://127.0.0.1:8843/projects/${f.project.id}`,
  );
  assert.match(
    response!.headers()["content-security-policy"],
    /style-src[^;]*nonce-/,
  );
  await page.locator(".react-flow__node-image").first().waitFor();
  assert.equal(
    (
      await page.request.get(
        `https://127.0.0.1:8843/api/images/tasks?projectId=${f.project.id}`,
      )
    ).status(),
    200,
  );
  const privateImage = await page.request.get(
    `https://127.0.0.1:8843/api/images/assets/${original.id}/original`,
  );
  assert.equal(privateImage.status(), 200);
  assert.equal(privateImage.headers()["cache-control"], "no-store");
  assert.equal(digest(await privateImage.body()), digest(originalBytes));
  await page.screenshot({
    path: join(artifact, "https-restored-workbench.png"),
    animations: "disabled",
  });
  const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const memberPage = await memberContext.newPage();
  await memberPage.goto("https://127.0.0.1:8843/login");
  await memberPage.getByLabel("账号", { exact: true }).fill("recovery-member");
  await memberPage.getByLabel("密码", { exact: true }).fill(testPassword);
  await memberPage.getByRole("button", { name: "登录", exact: true }).click();
  await memberPage
    .getByRole("heading", { name: "我的项目", exact: true })
    .waitFor();
  assert.equal(
    (
      await memberPage.request.get(
        `https://127.0.0.1:8843/api/images/assets/${original.id}/original`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await memberPage.request.get(
        `https://127.0.0.1:8843/api/projects/${f.project.id}`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await memberPage.request.get(
        "https://127.0.0.1:8843/api/image-admin/summary",
      )
    ).status(),
    403,
  );
  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  assert.equal(
    (
      await anonymous.request.get(
        `https://127.0.0.1:8843/api/images/assets/${original.id}/original`,
      )
    ).status(),
    401,
  );
  assert.deepEqual(cspErrors, []);
  report = {
    passed: true,
    restoredTestServer: true,
    nginxTemplate: true,
    database: "tuyile_test",
    port: 55440,
    schema: versions.length,
    files: files.length,
    originalHash: digest(originalBytes),
    newVolume: true,
    ownership: true,
    unknownNotReplayed: true,
    newImageAfterRestore: true,
    https: true,
    secureCookies: true,
    privateAssets: true,
    missingAndCorruptDetected: true,
  };
} finally {
  cleaning = true;
  const failures: string[] = [];
  async function cleanup(label: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch {
      failures.push(label);
    }
  }
  await cleanup("browser", async () => browser?.close());
  await cleanup("api", () => closeChild(api));
  await cleanup("proxy", async () => {
    if (proxyStarted) {
      try {
        const logs = await run("docker", ["logs", proxyName], {
          encoding: "buffer",
          maxBuffer: 1024 * 1024,
          timeout: 10000,
        });
        await writeFile(
          join(artifact, "nginx.log"),
          Buffer.concat([logs.stdout, logs.stderr]),
          { mode: 0o600 },
        );
      } finally {
        await command("docker", ["rm", "-f", proxyName]);
      }
    }
  });
  await cleanup("worker", async () => restoredWorker?.stop());
  await cleanup("restored-pool", async () => restoredPool?.end());
  await cleanup("source-worker", async () => worker?.stop());
  await cleanup("source-pool", async () => {
    if (f && !sourceClosed) await f.pool.end();
  });
  await cleanup("temporary-volume", async () => {
    if (restoreStarted)
      await command("docker", compose(restoreProject, "down", "-v"));
  });
  await cleanup("source-restart", async () => {
    if (sourceStopped)
      await command(
        "docker",
        compose(sourceProject, "up", "-d", "--wait", "postgres"),
      );
  });
  await cleanup("source-fixture", async () => {
    if (f) await rm(f.root, { recursive: true, force: true });
  });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (failures.length)
    throw new Error(`RECOVERY_CLEANUP_FAILED_${failures.join("_")}`);
}

if (interrupted) throw new Error("RECOVERY_INTERRUPTED");
assert(report);
await writeFile(
  join(artifact, "report.json"),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(
  "Local fresh-volume restore, hashes/relations/quotas, unknown-not-replayed, new generation, production HTTPS/two-account browser and Nginx template checks passed; original test server restored",
);
