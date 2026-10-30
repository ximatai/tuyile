import { finishTemporaryPassword } from "../test-database.js";
import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CreationService, ImageCallError, ImageExecutor } from "@tuyile/core";
import {
  createDatabase,
  PgCreationStore,
  ImageWorker,
  CompatibleImageProvider,
} from "@tuyile/infrastructure";
import { createApp } from "../../apps/api/src/app.js";
import { imageFixture } from "../creation-fixture.js";
import { testPassword, testUrls } from "../test-database.js";
let f: Awaited<ReturnType<typeof imageFixture>>;
beforeEach(async () => {
  f = await imageFixture();
});
afterEach(async () => {
  try {
    if (f) {
      expect(
        (
          await f.pool.query(
            "SELECT * FROM image_quota_reconciliation WHERE used<>ledger_used OR held<>ledger_held",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await f.pool.query(
            "SELECT * FROM image_reservation_reconciliation WHERE consumed<>task_used OR held<>task_held OR consumed<>ledger_used OR held<>ledger_held",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await f.pool.query(
            "SELECT t.id FROM image_tasks t WHERE t.used<>(SELECT count(*) FROM image_outputs o WHERE o.task_id=t.id)",
          )
        ).rows,
      ).toEqual([]);
    }
  } finally {
    await f?.cleanup();
  }
});
it("applies role defaults consistently before and after policy creation and allows explicit finite admin limits", async () => {
  expect(await f.repo.getPolicy(f.principal, f.principal.id)).toMatchObject({
    imageLimit: -1,
    attemptsLimit: 300,
  });
  expect(await f.repo.usage(f.principal)).toMatchObject({
    available: null,
    policy: { imageLimit: -1 },
  });
  const link = await f.service.createUser(f.principal, "quota_member");
  expect(await f.repo.getPolicy(f.principal, link.user.id)).toMatchObject({
    imageLimit: 100,
    attemptsLimit: 300,
  });
  await finishTemporaryPassword(f.service, link, testPassword);
  const session = await f.service.login("quota_member", testPassword);
  const member = (await f.service.authenticate(session.token)).user;
  expect(await f.repo.usage(member)).toMatchObject({
    available: 100,
    policy: { imageLimit: 100 },
  });
  const normal = await f.repo.getPolicy(f.principal, member.id);
  await f.repo.setPolicy(f.principal, member.id, { ...normal, imageLimit: -1 });
  expect(await f.repo.usage(member)).toMatchObject({ available: null });
  await f.creation.submit(f.principal, f.input());
  expect(await f.repo.getPolicy(f.principal, f.principal.id)).toMatchObject({
    imageLimit: -1,
  });
  expect(await f.repo.usage(f.principal)).toMatchObject({
    available: null,
    held: 1,
  });
  const admin = await f.repo.getPolicy(f.principal, f.principal.id);
  await f.repo.setPolicy(f.principal, f.principal.id, {
    ...admin,
    imageLimit: 1,
  });
  expect(await f.repo.usage(f.principal)).toMatchObject({
    available: 0,
    held: 1,
  });
  await expect(f.creation.submit(f.principal, f.input())).rejects.toMatchObject(
    { code: "IMAGE_QUOTA" },
  );
  await f.repo.setPolicy(f.principal, f.principal.id, {
    ...admin,
    imageLimit: -1,
  });
  await f.creation.submit(f.principal, f.input());
  expect(await f.repo.usage(f.principal)).toMatchObject({
    available: null,
    held: 2,
  });
});
it("serializes full-order admission and idempotent retries across concurrent submissions", async () => {
  const p = await f.repo.getPolicy(f.principal, f.principal.id);
  await f.repo.setPolicy(f.principal, f.principal.id, { ...p, imageLimit: 2 });
  const input = f.input();
  const same = await Promise.all([
    f.creation.submit(f.principal, input),
    f.creation.submit(f.principal, input),
  ]);
  expect(same[0].id).toBe(same[1].id);
  expect((await f.repo.usage(f.principal)).held).toBe(1);
  await expect(
    f.creation.submit(f.principal, { ...input, prompt: "different" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const results = await Promise.allSettled([
    f.creation.submit(f.principal, f.input()),
    f.creation.submit(f.principal, f.input()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await f.repo.usage(f.principal)).held).toBe(2);
  await f.repo.setPolicy(f.principal, f.principal.id, { ...p, imageLimit: 0 });
  expect((await f.repo.usage(f.principal)).held).toBe(2);
  await expect(f.creation.submit(f.principal, f.input())).rejects.toMatchObject(
    { code: "IMAGE_QUOTA" },
  );
});
it("separates queued capacity from execution concurrency, and enforces bounded admission/spec/model", async () => {
  await f.pool.query("UPDATE image_settings SET queue_limit=1 WHERE id=1");
  const t = await f.creation.submit(f.principal, f.input());
  await expect(f.creation.submit(f.principal, f.input())).rejects.toMatchObject(
    { code: "QUEUE_FULL" },
  );
  const work = await f.repo.claim([], 0);
  expect(work?.id).toBe(t.id);
  const second = await f.creation.submit(f.principal, f.input());
  expect(second.state).toBe("queued");
  expect(await f.repo.claim([f.principal.id], 1)).toBeNull();
  await f.repo.cancel(f.principal, second.id);
  await f.repo.finish(work!, "TEST_STOP", true);
  await expect(
    f.creation.submit(f.principal, f.input({ model: "forbidden" })),
  ).rejects.toMatchObject({ code: "MODEL_NOT_ALLOWED" });
  await expect(
    f.creation.submit(f.principal, f.input({ width: 4096 })),
  ).rejects.toMatchObject({ code: "SPEC_LIMIT" });
});
it("persists referenced generation after ordinary logout; keeps content private and storage reclaim idempotent", async () => {
  const upload = await f.creation.upload(f.principal, f.png);
  const t = await f.creation.submit(
    f.principal,
    f.input({ referenceIds: [upload.id], count: 2 }),
  );
  await expect(f.creation.delete(f.principal, upload.id)).rejects.toMatchObject(
    { code: "ASSET_REFERENCED" },
  );
  await f.service.logout(f.login.token);
  await f.worker();
  const completed = await f.done(t.id);
  expect(completed.state).toBe("succeeded");
  expect(completed.outputs).toHaveLength(2);
  expect((await f.repo.usage(f.principal)).used).toBe(2);
  expect(
    (await f.creation.bytes(f.principal, completed.outputs[0].id)).bytes.length,
  ).toBeGreaterThan(0);
  const member = await f.service.createUser(f.principal, "other");
  await finishTemporaryPassword(f.service, member, testPassword);
  const session = await f.service.login("other", testPassword),
    p = (await f.service.authenticate(session.token)).user;
  await expect(f.repo.task(p, t.id)).rejects.toMatchObject({ status: 404 });
  await expect(f.creation.bytes(p, upload.id)).rejects.toMatchObject({
    status: 404,
  });
  const owned = await f.creation.upload(p, f.png);
  await expect(f.creation.bytes(f.principal, owned.id)).rejects.toMatchObject({
    status: 404,
  });
  const usage = await f.repo.usage(f.principal);
  const a = await f.repo.asset(f.principal, completed.outputs[0].id);
  await f.creation.delete(f.principal, a.id);
  await f.repo.finalizeDelete(a);
  expect((await f.repo.usage(f.principal)).storageUsed).toBe(
    usage.storageUsed - a.bytes - a.previewBytes,
  );
  expect((await f.repo.task(f.principal, t.id)).outputs[0].deleted).toBe(true);
});
it("keeps partial success and unknown holds; metadata-only manual resolution is idempotent and does not send models", async () => {
  let calls = 0;
  const reference = await f.creation.upload(f.principal, f.png);
  const t = await f.creation.submit(
    f.principal,
    f.input({ count: 3, referenceIds: [reference.id] }),
  );
  await f.worker({
    generate: async () => {
      calls++;
      if (calls === 2) throw new ImageCallError("unknown", "RESULT_UNKNOWN");
      return f.png;
    },
  });
  const result = await f.done(t.id);
  expect(result.state).toBe("partial");
  expect(result.used).toBe(1);
  expect(result.held).toBe(1);
  expect(result.pendingReview).toBe(true);
  expect(calls).toBe(2);
  const review = await f.repo.review(f.principal);
  expect(JSON.stringify(review)).not.toContain("Synthetic private prompt");
  expect(JSON.stringify(review)).not.toContain("secret");
  await expect(
    f.creation.delete(f.principal, reference.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  await f.repo.resolve(f.principal, t.id, 0, "Verified upstream no image");
  await f.repo.resolve(f.principal, t.id, 0, "Verified upstream no image");
  await expect(
    f.repo.resolve(f.principal, t.id, 1, "other reason"),
  ).rejects.toMatchObject({ code: "RESOLUTION_CONFLICT" });
  expect((await f.repo.usage(f.principal)).held).toBe(0);
  expect(calls).toBe(2);
  await f.creation.delete(f.principal, reference.id);
});
it("retries only one definitive 429 and enforces actual-dispatch attempt budgets", async () => {
  let calls = 0;
  const t = await f.creation.submit(f.principal, f.input());
  await f.worker({
    generate: async () => {
      calls++;
      if (calls === 1)
        throw new ImageCallError("rejected", "UPSTREAM_RATE_LIMIT", 429);
      return f.png;
    },
  });
  expect((await f.done(t.id)).state).toBe("succeeded");
  expect(calls).toBe(2);
  expect((await f.repo.usage(f.principal)).attempts).toBe(2);
  const policy = await f.repo.getPolicy(f.principal, f.principal.id);
  await f.repo.setPolicy(f.principal, f.principal.id, {
    ...policy,
    attemptsLimit: 2,
  });
  const exhausted = await f.creation.submit(f.principal, f.input());
  expect((await f.done(exhausted.id)).state).toBe("failed");
  expect(calls).toBe(2);
});
it("stops dispatch on cancel, disable/re-enable or credential reset; in-flight outcomes may remain unknown", async () => {
  const pending = await f.creation.submit(f.principal, f.input());
  await f.repo.cancel(f.principal, pending.id);
  expect((await f.repo.task(f.principal, pending.id)).state).toBe("cancelled");
  expect((await f.repo.usage(f.principal)).held).toBe(0);
  const member = await f.service.createUser(f.principal, "revoked");
  await finishTemporaryPassword(f.service, member, testPassword);
  const session = await f.service.login("revoked", testPassword),
    p = (await f.service.authenticate(session.token)).user;
  const project = await f.service.createProject(p, "revoked project");
  const queued = await f.creation.submit(p, f.input({ projectId: project.id }));
  await f.service.enable(f.principal, p.id, false);
  await f.service.enable(f.principal, p.id, true);
  await f.worker();
  const fresh = await f.service.login("revoked", testPassword),
    principal = (await f.service.authenticate(fresh.token)).user;
  for (let n = 0; n < 100; n++) {
    const r = await f.repo.task(principal, queued.id);
    if (r.state === "cancelled") break;
    await new Promise((r) => setTimeout(r, 25));
  }
  expect((await f.repo.task(principal, queued.id)).state).toBe("cancelled");
});
it("refuses a second Worker and classifies old running work without replaying unknown calls", async () => {
  const t = await f.creation.submit(f.principal, f.input({ count: 2 })),
    work = await f.repo.claim([], 0);
  await f.repo.dispatch(work!, 0, 0);
  let calls = 0;
  const first = await f.worker({
    generate: async () => {
      calls++;
      return f.png;
    },
  });
  const other = new ImageWorker(
    f.pool,
    f.repo,
    f.files,
    new CompatibleImageProvider(true),
    () => {},
  );
  await expect(other.start()).rejects.toThrow("WORKER_ALREADY_RUNNING");
  const r = await f.repo.task(f.principal, t.id);
  expect(r.state).toBe("failed");
  expect(r.held).toBe(1);
  expect(r.pendingReview).toBe(true);
  expect(calls).toBe(0);
  expect(first.fatal()).toBe(false);
});
it("settles creation-day holds while limiting cross-day attempts on the actual dispatch date", async () => {
  let now = new Date("2026-10-29T15:59:00Z");
  const store = new PgCreationStore(
      f.pool,
      process.env.APP_MASTER_KEY!,
      true,
      () => now,
    ),
    service = new CreationService(store, f.files),
    repo = service;
  const t = await service.submit(f.principal, f.input());
  now = new Date("2026-10-29T16:01:00Z");
  const work = await repo.claim([], 0);
  await new ImageExecutor(repo, f.files, {
    generate: async () => f.png,
  }).execute(work!, new AbortController().signal);
  const rows = (
    await f.pool.query(
      "SELECT day::text,used,held,attempts FROM image_days ORDER BY day",
    )
  ).rows;
  expect(rows.find((r) => r.day === "2026-10-29")).toMatchObject({
    used: 1,
    held: 0,
    attempts: 0,
  });
  expect(rows.find((r) => r.day === "2026-10-30")).toMatchObject({
    used: 0,
    held: 0,
    attempts: 1,
  });
  expect((await repo.task(f.principal, t.id)).state).toBe("succeeded");
});
it("keeps confirmed ready files after acknowledgement loss, and cleans failed writes without counting success", async () => {
  const original = f.repo.commitAsset.bind(f.repo);
  f.repo.commitAsset = async (a, image, attempt) => {
    await original(a, image, attempt);
    throw new Error("ACK_LOST");
  };
  let assetId = "";
  await expect(f.creation.upload(f.principal, f.png)).rejects.toThrow(
    "ACK_LOST",
  );
  const r = (
    await f.pool.query("SELECT * FROM image_assets WHERE state='ready'")
  ).rows[0];
  assetId = r.id;
  expect((await f.creation.bytes(f.principal, assetId)).bytes.length).toBe(
    f.png.length,
  );
  f.repo.commitAsset = original;
  const failed = await f.creation.submit(f.principal, f.input());
  await f.worker(
    { generate: async () => f.png },
    {
      ...f.files,
      inspect: f.files.inspect.bind(f.files),
      freeSpace: f.files.freeSpace.bind(f.files),
      read: f.files.read.bind(f.files),
      remove: f.files.remove.bind(f.files),
      write: async () => {
        throw new Error("DISK_WRITE_FAILED");
      },
    },
  );
  const t = await f.done(failed.id);
  expect(t.used).toBe(0);
  expect(t.pendingReview).toBe(true);
  expect((await f.repo.usage(f.principal)).storageReserved).toBe(0);
});
it("rejects invalid/bomb uploads, verifies hashes and HTTP scope/CSRF, and never exposes provider credentials", async () => {
  await expect(
    f.creation.upload(f.principal, new Uint8Array([1, 2, 3])),
  ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  expect((await f.repo.usage(f.principal)).storageReserved).toBe(0);
  const a = await f.creation.upload(f.principal, f.png);
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
  );
  expect(
    (await app.request(`/api/images/assets/${a.id}/original`)).status,
  ).toBe(401);
  const headers = { Cookie: `tuyile_session=${f.login.token}` };
  const original = await app.request(`/api/images/assets/${a.id}/original`, {
    headers,
  });
  expect(original.status).toBe(200);
  expect(original.headers.get("cache-control")).toBe("no-store");
  expect(
    (
      await app.request("/api/images/tasks", {
        method: "POST",
        headers: {
          ...headers,
          Origin: "http://127.0.0.1:5180",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  await f.repo.saveProvider(f.principal, {
    mode: "openai",
    baseUrl: "https://provider.example/v1",
    models: ["private-model"],
    apiKey: "synthetic-key-do-not-expose",
    preserveKey: false,
  });
  expect(JSON.stringify(await f.repo.providers(f.principal))).not.toContain(
    "synthetic-key",
  );
  expect(JSON.stringify(await f.repo.usage(f.principal))).not.toContain(
    "provider.example",
  );
  const stored = (
    await f.pool.query(
      "SELECT secret_cipher FROM image_provider_versions WHERE active",
    )
  ).rows[0];
  expect(stored.secret_cipher).not.toContain("synthetic-key");
  const row = await f.repo.asset(f.principal, a.id);
  await writeFile(join(f.root, `${row.fileKey}.original`), "corrupt");
  await expect(f.creation.bytes(f.principal, a.id)).rejects.toMatchObject({
    code: "ASSET_UNAVAILABLE",
  });
});
it("cancels an in-flight call without dispatching later outputs", async () => {
  let entered: () => void = () => {},
    calls = 0;
  const started = new Promise<void>((r) => (entered = r));
  const t = await f.creation.submit(f.principal, f.input({ count: 2 }));
  await f.worker({
    generate: async (_c, _i, _r, signal) => {
      calls++;
      entered();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new ImageCallError("unknown", "CALL_INTERRUPTED")),
          { once: true },
        );
      });
    },
  });
  await started;
  await f.repo.cancel(f.principal, t.id);
  const result = await f.done(t.id);
  expect(calls).toBe(1);
  expect(result.held).toBe(1);
  expect(result.pendingReview).toBe(true);
});
it("preserves earlier ready outputs on Worker restart and releases steps never dispatched", async () => {
  const t = await f.creation.submit(f.principal, f.input({ count: 3 })),
    work = (await f.repo.claim([], 0))!;
  const d = (await f.repo.dispatch(work, 0, 0))!;
  await f.repo.attemptResult(d.attemptId, "received");
  const a = await f.repo.outputIntent(work, 0),
    image = await f.files.inspect(f.png);
  await f.files.write(a.fileKey, image);
  await f.repo.commitAsset(a, image, d.attemptId);
  await f.repo.dispatch(work, 1, 0);
  await f.worker();
  const result = await f.repo.task(f.principal, t.id);
  expect(result.state).toBe("partial");
  expect(result.used).toBe(1);
  expect(result.held).toBe(1);
  expect(result.outputs).toHaveLength(1);
  expect((await f.creation.bytes(f.principal, a.id)).bytes.length).toBe(
    f.png.length,
  );
});
it("retains a ready task output after DB acknowledgement loss without duplicate settlement", async () => {
  const commit = f.repo.commitAsset.bind(f.repo);
  f.repo.commitAsset = async (a, b, id) => {
    await commit(a, b, id);
    throw new Error("ACK_LOST");
  };
  const t = await f.creation.submit(f.principal, f.input());
  await f.worker({ generate: async () => f.png });
  const result = await f.done(t.id);
  expect(result.state).toBe("succeeded");
  expect(result.used).toBe(1);
  expect(result.held).toBe(0);
  expect(result.outputs).toHaveLength(1);
  expect(
    (await f.creation.bytes(f.principal, result.outputs[0].id)).bytes.length,
  ).toBe(f.png.length);
});

it("reads fresh quota without writes while admission and user locks are held", async () => {
  const lock = await f.pool.connect();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let reads: Promise<unknown> | undefined;
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT pg_advisory_xact_lock(72110403)");
    await lock.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      f.principal.id,
    ]);
    reads = Promise.all([
      f.repo.usage(f.principal),
      f.repo.tasks(f.principal),
      f.repo.uploads(f.principal),
      f.repo.getPolicy(f.principal, f.principal.id),
      f.repo.providers(f.principal),
      f.repo.review(f.principal),
    ]);
    const results = (await Promise.race([
      reads,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("READ_BLOCKED_BY_WRITE_LOCK")),
          2000,
        );
      }),
    ])) as Awaited<ReturnType<typeof f.repo.usage>>[];
    expect(results[0]).toMatchObject({
      used: 0,
      held: 0,
      available: null,
      storageUsed: 0,
    });
    expect(
      (await f.pool.query("SELECT count(*)::int n FROM image_policies")).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await f.pool.query("SELECT count(*)::int n FROM image_days")).rows[0].n,
    ).toBe(0);
  } finally {
    if (timeout) clearTimeout(timeout);
    await lock.query("ROLLBACK");
    lock.release();
    await reads?.catch(() => {});
  }
});

it("never charges image quota for an upstream success without a persisted output", async () => {
  const t = await f.creation.submit(f.principal, f.input());
  const work = (await f.repo.claim([], 0))!;
  const dispatch = (await f.repo.dispatch(work, 0, 0))!;
  await f.repo.attemptResult(dispatch.attemptId, "unknown");
  await f.repo.finish(work, "RESULT_UNKNOWN");
  await expect(
    f.repo.resolve(f.principal, t.id, 1, "Upstream reports billed"),
  ).rejects.toMatchObject({ code: "INVALID_RESOLUTION" });
  expect(await f.repo.usage(f.principal)).toMatchObject({
    used: 0,
    held: 1,
    attempts: 1,
  });
  await f.repo.resolve(
    f.principal,
    t.id,
    0,
    "Verified image cannot be obtained",
  );
  await f.repo.resolve(
    f.principal,
    t.id,
    0,
    "Verified image cannot be obtained",
  );
  await f.repo.attemptResult(dispatch.attemptId, "received");
  expect(await f.repo.usage(f.principal)).toMatchObject({
    used: 0,
    held: 0,
    attempts: 1,
  });
  expect(await f.repo.task(f.principal, t.id)).toMatchObject({
    used: 0,
    held: 0,
    outputs: [],
    pendingReview: false,
  });
});

it("upgrades synthetic M2 charges without inventing local outputs or erasing audit evidence", async () => {
  const { pool } = createDatabase(testUrls().owner);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL search_path=pg_temp,pg_catalog");
    await c.query(
      (await readFile("migrations/0001_identity.sql", "utf8"))
        .replaceAll("CREATE TABLE", "CREATE TEMP TABLE")
        .replaceAll("CREATE VIEW", "CREATE TEMP VIEW"),
    );
    await c.query(
      (await readFile("migrations/0002_creation.sql", "utf8"))
        .replaceAll("CREATE TABLE", "CREATE TEMP TABLE")
        .replaceAll("CREATE VIEW", "CREATE TEMP VIEW"),
    );
    const uid = randomUUID(),
      ws = randomUUID(),
      project = randomUUID(),
      provider = randomUUID(),
      task = randomUUID();
    await c.query(
      "INSERT INTO users(id,username,role) VALUES($1,'synthetic','admin')",
      [uid],
    );
    await c.query("INSERT INTO workspaces(id,owner_id) VALUES($1,$2)", [
      ws,
      uid,
    ]);
    await c.query(
      "INSERT INTO projects(id,workspace_id,name) VALUES($1,$2,'Synthetic')",
      [project, ws],
    );
    await c.query(
      "INSERT INTO image_provider_versions(id,mode,base_url,models,secret_cipher) VALUES($1,'fake','','[]','')",
      [provider],
    );
    await c.query(
      "INSERT INTO image_tasks(id,workspace_id,project_id,user_id,execution_version,request_key,input_hash,input,policy,provider_id,day,state,held,used,storage_remaining,deadline,resolved_at) VALUES($1,$2,$3,$4,1,$5,'synthetic','{\"count\":2}','{}',$6,'2026-10-29','partial',0,2,0,now(),now())",
      [task, ws, project, uid, randomUUID(), provider],
    );
    await c.query(
      "INSERT INTO image_assets(workspace_id,user_id,task_id,ordinal,state,hash) VALUES($1,$2,$3,0,'deleted','synthetic-historical-hash')",
      [ws, uid, task],
    );
    await c.query(
      "INSERT INTO image_days(user_id,day,used,held,attempts) VALUES($1,'2026-10-29',2,0,2)",
      [uid],
    );
    await c.query(
      "INSERT INTO image_audit(actor_id,task_id,confirmed,reason) VALUES($1,$2,1,'Synthetic upstream billed')",
      [uid, task],
    );
    await c.query(
      await readFile("migrations/0003_outputs_and_quota.sql", "utf8"),
    );
    await c.query(
      await readFile("migrations/0004_quota_reservations.sql", "utf8"),
    );
    expect(
      (
        await c.query(
          "SELECT accepted,consumed,held,released FROM image_quota_reservations",
        )
      ).rows[0],
    ).toEqual({ accepted: 2, consumed: 1, held: 0, released: 1 });
    expect(
      (await c.query("SELECT used,held,attempts FROM image_days")).rows[0],
    ).toEqual({ used: 1, held: 0, attempts: 2 });
    expect(
      (
        await c.query(
          "SELECT previous_used,corrected_used FROM image_quota_corrections",
        )
      ).rows[0],
    ).toEqual({ previous_used: 2, corrected_used: 1 });
    expect(
      (await c.query("SELECT confirmed FROM image_audit")).rows[0].confirmed,
    ).toBe(1);
    expect((await c.query("SELECT * FROM image_outputs")).rows).toHaveLength(1);
    expect(
      (
        await c.query(
          "SELECT * FROM image_quota_reconciliation WHERE used<>ledger_used OR held<>ledger_held",
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await c.query("ROLLBACK");
    c.release();
    await pool.end();
  }
});

it("does not serialize unrelated asset writes behind the queue admission lock", async () => {
  const lock = await f.pool.connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let write: ReturnType<typeof f.creation.upload> | undefined;
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT pg_advisory_xact_lock(72110403)");
    write = f.creation.upload(f.principal, f.png);
    const uploaded = await Promise.race([
      write,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("ASSET_WRITE_BLOCKED_BY_QUEUE")),
          2000,
        );
      }),
    ]);
    expect(uploaded.state).toBe("ready");
  } finally {
    if (timer) clearTimeout(timer);
    await lock.query("ROLLBACK");
    lock.release();
    await write?.catch(() => {});
  }
});

it("keeps output identity and its quota history after physical image deletion", async () => {
  const t = await f.creation.submit(f.principal, f.input());
  await f.worker();
  const result = await f.done(t.id);
  const output = result.outputs[0];
  expect(output.outputId).toBeTruthy();
  await f.creation.delete(f.principal, output.id);
  const deleted = (await f.repo.task(f.principal, t.id)).outputs[0];
  expect(deleted).toMatchObject({
    id: output.id,
    outputId: output.outputId,
    deleted: true,
  });
  expect(await f.repo.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
  expect(
    (
      await f.pool.query(
        "SELECT count(*)::int n FROM image_quota_entries WHERE output_id=$1",
        [output.outputId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("rolls back task, reservation and pins when admission fails between modules", async () => {
  const reference = await f.creation.upload(f.principal, f.png);
  const service = new CreationService(
    {
      read: (run) => f.creationStore.read(run),
      write: (lock, run) =>
        f.creationStore.write(lock, (r) => {
          const pin = r.assets.pin.bind(r.assets);
          r.assets.pin = async (...args) => {
            await pin(...args);
            throw new Error("AFTER_REFERENCE_WRITE");
          };
          return run(r);
        }),
    },
    f.files,
  );
  await expect(
    service.submit(f.principal, f.input({ referenceIds: [reference.id] })),
  ).rejects.toThrow("AFTER_REFERENCE_WRITE");
  for (const table of [
    "image_tasks",
    "image_quota_reservations",
    "image_quota_entries",
    "image_references",
  ])
    expect(
      (await f.pool.query(`SELECT count(*)::integer n FROM ${table}`)).rows[0]
        .n,
    ).toBe(0);
  expect(await f.repo.usage(f.principal)).toMatchObject({
    used: 0,
    held: 0,
    storageReserved: 0,
  });
});

it("rolls back output, consumption and publication together, then permits one safe commit", async () => {
  const task = await f.creation.submit(f.principal, f.input());
  const work = (await f.repo.claim([], 0))!;
  const attempt = (await f.repo.dispatch(work, 0, 0))!;
  await f.repo.attemptResult(attempt.attemptId, "received");
  const asset = await f.repo.outputIntent(work, 0);
  const image = await f.files.inspect(f.png);
  await f.files.write(asset.fileKey, image);
  const service = new CreationService(
    {
      read: (run) => f.creationStore.read(run),
      write: (lock, run) =>
        f.creationStore.write(lock, (r) => {
          const publish = r.assets.publish.bind(r.assets);
          r.assets.publish = async (...args) => {
            await publish(...args);
            throw new Error("AFTER_ASSET_PUBLICATION");
          };
          return run(r);
        }),
    },
    f.files,
  );
  await expect(
    service.commitAsset(asset, image, attempt.attemptId),
  ).rejects.toThrow("AFTER_ASSET_PUBLICATION");
  expect(
    (
      await f.pool.query("SELECT state FROM image_assets WHERE id=$1", [
        asset.id,
      ])
    ).rows[0].state,
  ).toBe("staging");
  expect(
    (
      await f.pool.query("SELECT state FROM image_attempts WHERE id=$1", [
        attempt.attemptId,
      ])
    ).rows[0].state,
  ).toBe("received");
  expect(
    (await f.pool.query("SELECT count(*)::integer n FROM image_outputs"))
      .rows[0].n,
  ).toBe(0);
  expect(await f.repo.usage(f.principal)).toMatchObject({ used: 0, held: 1 });
  await f.repo.commitAsset(asset, image, attempt.attemptId);
  await f.repo.commitAsset(asset, image, attempt.attemptId);
  await f.repo.finish(work);
  expect(await f.repo.task(f.principal, task.id)).toMatchObject({
    used: 1,
    held: 0,
    state: "succeeded",
  });
  expect(
    (
      await f.pool.query(
        "SELECT consumed,held,released FROM image_quota_reservations",
      )
    ).rows[0],
  ).toEqual({ consumed: 1, held: 0, released: 0 });
});

it("orders reference admission against asset deletion without a dangling pin", async () => {
  const reference = await f.creation.upload(f.principal, f.png);
  const [submission, deletion] = await Promise.allSettled([
    f.creation.submit(f.principal, f.input({ referenceIds: [reference.id] })),
    f.creation.delete(f.principal, reference.id),
  ]);
  if (submission.status === "fulfilled") {
    expect(deletion).toMatchObject({
      status: "rejected",
      reason: { code: "ASSET_REFERENCED" },
    });
    await f.repo.cancel(f.principal, submission.value.id);
  } else {
    expect(submission.reason).toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
    expect(deletion.status).toBe("fulfilled");
  }
  expect(
    (
      await f.pool.query(
        "SELECT r.asset_id FROM image_references r JOIN image_assets a ON a.id=r.asset_id WHERE a.state<>'ready'",
      )
    ).rows,
  ).toEqual([]);
});

it("serializes manual release against late attempt evidence", async () => {
  await f.creation.submit(f.principal, f.input());
  const work = (await f.repo.claim([], 0))!;
  const attempt = (await f.repo.dispatch(work, 0, 0))!;
  await f.repo.finish(work, "RESULT_UNKNOWN");
  await Promise.all([
    f.repo.resolve(f.principal, work.id, 0, "Verified no retrievable image"),
    f.repo.attemptResult(attempt.attemptId, "received"),
  ]);
  expect(await f.repo.usage(f.principal)).toMatchObject({
    used: 0,
    held: 0,
    attempts: 1,
  });
  expect(
    (
      await f.pool.query("SELECT state FROM image_attempts WHERE id=$1", [
        attempt.attemptId,
      ])
    ).rows[0].state,
  ).toBe("resolved");
});

it("snapshots separate style and final prompt, binds idempotency and dispatches the snapshot once", async () => {
  const input = f.input({ style: { name: "摄影", text: "柔和自然光" } });
  const task = await f.creation.submit(f.principal, input);
  const finalPrompt = `${input.prompt}\n\n画面风格：柔和自然光`;
  expect(task).toMatchObject({
    prompt: input.prompt,
    finalPrompt,
    settings: { style: input.style },
  });
  expect(
    (await f.pool.query("SELECT input FROM image_tasks WHERE id=$1", [task.id]))
      .rows[0].input.finalPrompt,
  ).toBe(finalPrompt);
  await expect(
    f.creation.submit(f.principal, {
      ...input,
      style: { ...input.style!, text: "不同光线" },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  let dispatched = 0;
  await f.worker({
    generate: async (_config, sent) => {
      dispatched++;
      expect(sent.prompt).toBe(finalPrompt);
      expect(sent.style).toBeUndefined();
      return f.png;
    },
  });
  expect((await f.done(task.id)).state).toBe("succeeded");
  expect(dispatched).toBe(1);
  expect((await f.creation.task(f.principal, task.id)).prompt).toBe(
    input.prompt,
  );
});
it("rejects the combined prompt budget before reserving images", async () => {
  await expect(
    f.creation.submit(
      f.principal,
      f.input({
        prompt: "a".repeat(11990),
        style: { name: "摄影", text: "b".repeat(30) },
      }),
    ),
  ).rejects.toMatchObject({ code: "PROMPT_TOO_LONG" });
  expect((await f.creation.usage(f.principal)).held).toBe(0);
});
