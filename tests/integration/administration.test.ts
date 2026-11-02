import { finishTemporaryPassword } from "../test-database.js";
import { beforeEach, afterEach, expect, it } from "vitest";
import {
  AdministrationService,
  AgentService,
  ExtensionService,
  PlanningExecutor,
} from "@tuyile/core";
import { PgAdministrationStore } from "@tuyile/infrastructure";
import {
  planningPolicyInput,
  planningProviderInput,
  planningRequest,
} from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
import { testPassword } from "../test-database.js";
let f: Awaited<ReturnType<typeof imageFixture>>,
  admin: AdministrationService,
  agent: AgentService;
beforeEach(async () => {
  f = await imageFixture();
  admin = new AdministrationService(new PgAdministrationStore(f.pool), f.files);
  agent = new AgentService(f.creationStore, f.files);
  await new ExtensionService(f.creationStore).savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "fake",
      baseUrl: "",
      model: "test-planner",
    }),
  );
});
afterEach(async () => {
  await f?.cleanup();
});
function request() {
  const { count, ...input } = f.input();
  return planningRequest.parse(input);
}
it("applies planning queue and concurrency settings while preserving accepted reservations after lowering quota", async () => {
  await admin.savePolicy(
    f.principal,
    f.principal.id,
    planningPolicyInput.parse({
      dailyLimit: 50,
      concurrency: 2,
      queueLimit: 10,
    }),
  );
  const settings = await admin.settings(f.principal);
  await admin.saveSettings(f.principal, {
    ...settings,
    planning: { concurrency: 1, queueLimit: 1 },
  });
  await agent.request(f.principal, request());
  await expect(agent.request(f.principal, request())).rejects.toMatchObject({
    code: "PLANNING_QUEUE_FULL",
  });
  const first = (await agent.claim([]))!;
  await agent.request(f.principal, request());
  expect(await agent.claim([f.principal.id])).toBeNull();
  await admin.saveSettings(f.principal, {
    ...settings,
    planning: { concurrency: 2, queueLimit: 64 },
  });
  const second = (await agent.claim([f.principal.id]))!;
  expect(second).not.toBeNull();
  await admin.savePolicy(
    f.principal,
    f.principal.id,
    planningPolicyInput.parse({ dailyLimit: 0, concurrency: 2 }),
  );
  expect(await agent.usage(f.principal)).toMatchObject({
    held: 2,
    available: 0,
  });
  await new PlanningExecutor(agent, {
    complete: async () => ({
      text: JSON.stringify({ message: "澄清", steps: [] }),
      inputTokens: null,
      outputTokens: null,
    }),
  }).execute(first, new AbortController().signal);
  await agent.finish(second, undefined, "CANCELLED");
  expect(await agent.usage(f.principal)).toMatchObject({
    used: 1,
    held: 0,
    available: 0,
  });
  await expect(agent.request(f.principal, request())).rejects.toMatchObject({
    code: "PLANNING_QUOTA",
  });
});
it("returns metadata-only administration summaries and reports reconciliation differences", async () => {
  const task = await f.creation.submit(f.principal, f.input());
  const work = (await f.repo.claim([], 0))!;
  await f.repo.finish(work, "SYNTHETIC_FAILURE");
  await admin.savePolicy(
    f.principal,
    f.principal.id,
    planningPolicyInput.parse({ dailyLimit: 40, concurrency: 1 }),
  );
  let summary = await admin.summary(f.principal);
  expect(summary.reconciliation).toEqual({
    imageDays: 0,
    imageReservations: 0,
    planningDays: 0,
  });
  expect(summary.errors.some((e) => e.id === task.id)).toBe(true);
  expect(summary.audits.some((a) => a.action === "planning-policy")).toBe(true);
  expect(JSON.stringify(summary)).not.toContain("Synthetic private prompt");
  expect(JSON.stringify(summary)).not.toContain("messages");
  expect(JSON.stringify(summary)).not.toContain("secret_cipher");
  await f.pool.query("UPDATE image_days SET held=held+1 WHERE user_id=$1", [
    f.principal.id,
  ]);
  summary = await admin.summary(f.principal);
  expect(summary.reconciliation.imageDays).toBe(1);
  await f.pool.query("UPDATE image_days SET held=held-1 WHERE user_id=$1", [
    f.principal.id,
  ]);
  const created = await f.service.createUser(f.principal, "admin-stats-member");
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login("admin-stats-member", testPassword),
    member = (await f.service.authenticate(login.token)).user;
  await expect(admin.summary(member)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    admin.saveSettings(member, await admin.settings(f.principal)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("clears only ended planning content, releases its pins and retains planning quota evidence", async () => {
  const asset = await f.creation.upload(f.principal, f.png),
    input = { ...request(), referenceIds: [asset.id] };
  const job = await agent.request(f.principal, input);
  await expect(
    agent.clearHistory(f.principal, f.project.id),
  ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
  const work = (await agent.claim([]))!;
  await new PlanningExecutor(agent, {
    complete: async () => ({
      text: JSON.stringify({ message: "澄清", steps: [] }),
      inputTokens: 1,
      outputTokens: 1,
    }),
  }).execute(work, new AbortController().signal);
  const plan = (await agent.jobs(f.principal, f.project.id))[0].plans[0];
  await expect(
    f.creation.deleteAsset(f.principal, asset.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  await agent.clearHistory(f.principal, f.project.id);
  expect(await agent.jobs(f.principal, f.project.id)).toEqual([]);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
  await expect(agent.confirm(f.principal, plan.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(agent.request(f.principal, input)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    (
      await f.pool.query(
        "SELECT input,messages,archived FROM planning_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0],
  ).toMatchObject({ input: {}, messages: [], archived: true });
  await f.creation.delete(f.principal, asset.id);
  expect((await admin.summary(f.principal)).reconciliation.planningDays).toBe(
    0,
  );
});

it("tracks daily quota and exposes only generated artwork with scoped audited access", async () => {
  const upload = await f.creation.upload(f.principal, f.png);
  const created = await f.service.createUser(f.principal, "artwork-member");
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login(created.user.username, testPassword);
  const member = (await f.service.authenticate(login.token)).user;
  const project = await f.service.createProject(member, "Synthetic member art");
  const task = await f.creation.submit(
    member,
    f.input({ projectId: project.id }),
  );
  let users = await f.service.users(f.principal);
  expect(users.find((u) => u.id === member.id)?.today?.images).toMatchObject({
    used: 0,
    held: 1,
    limit: 100,
  });
  await f.worker();
  await expect
    .poll(async () => (await f.creation.task(member, task.id)).state)
    .toBe("succeeded");
  const result = await f.creation.task(member, task.id);
  const output = result.outputs[0];
  expect(output).toBeDefined();
  expect(await admin.artworks(f.principal, member.id, 0)).toEqual([
    expect.objectContaining({ id: output.id, model: "test-image" }),
  ]);
  expect(
    (await admin.bytes(f.principal, member.id, output.id, true)).bytes.length,
  ).toBeGreaterThan(0);
  expect(
    (
      await f.pool.query(
        "SELECT values FROM administration_audit WHERE action='artwork-view' AND target_id=$1",
        [member.id],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    admin.bytes(f.principal, f.principal.id, output.id, true),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    admin.bytes(f.principal, f.principal.id, upload.id, true),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(admin.artworks(member, member.id, 0)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    admin.bytes(member, member.id, output.id, true),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.creation.bytes(f.principal, output.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  users = await f.service.users(f.principal);
  expect(users.find((u) => u.id === member.id)?.today?.images).toMatchObject({
    used: 1,
    held: 0,
  });
  expect(
    JSON.stringify(await admin.artworks(f.principal, member.id, 0)),
  ).not.toContain("prompt");
  await f.pool.query(
    "UPDATE image_outputs SET created_at=now()-interval '2 days' WHERE asset_id=$1",
    [output.id],
  );
  expect(await admin.artworks(f.principal, member.id, 0)).toEqual([]);
  // Shanghai midnight is 16:00 UTC on the previous calendar day.
  await f.pool.query(
    `UPDATE image_outputs SET created_at=(now() AT TIME ZONE 'Asia/Shanghai')::date::timestamp AT TIME ZONE 'Asia/Shanghai' WHERE asset_id=$1`,
    [output.id],
  );
  expect(await admin.artworks(f.principal, member.id, 0)).toHaveLength(1);
  await f.pool.query(
    "UPDATE image_outputs SET created_at=created_at-interval '1 microsecond' WHERE asset_id=$1",
    [output.id],
  );
  expect(await admin.artworks(f.principal, member.id, 0)).toHaveLength(0);
  await f.pool.query(
    `UPDATE image_outputs SET created_at=((now() AT TIME ZONE 'Asia/Shanghai')::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai' WHERE asset_id=$1`,
    [output.id],
  );
  expect(await admin.artworks(f.principal, member.id, 0)).toHaveLength(0);
});

it("aggregates dispatch-day tokens across projects and preserves missing usage and immutable prices", async () => {
  const task = await f.creation.submit(f.principal, f.input());
  await f.worker();
  await f.done(task.id);
  let report = await admin.tokenUsage(f.principal, "month");
  expect(report.today).toMatchObject({
    calls: 1,
    inputTokens: 100,
    outputTokens: 256,
    pricedCalls: 0,
    referenceUsd: null,
    unknownUsage: 0,
  });
  const row = (
    await f.pool.query(
      "SELECT id,model_usage FROM image_attempts WHERE task_id=$1",
      [task.id],
    )
  ).rows[0];
  // Controlled response evidence for an official-priced image call, independent of real network access.
  const { referencePrice, referenceCost } = await import("@tuyile/core");
  const price = referencePrice("gpt-image-2.5-sunburst", "image");
  await f.pool.query(
    "UPDATE image_attempts SET price_snapshot=$2,reference_usd=$3 WHERE id=$1",
    [row.id, price, referenceCost(row.model_usage, price)],
  );
  report = await admin.tokenUsage(f.principal, "today");
  expect(report.today.referenceUsd).toBeCloseTo(0.00818);
  expect(report.users.find((u) => u.id === f.principal.id)!).toMatchObject({
    id: f.principal.id,
    calls: 1,
    inputTokens: 100,
  });
  await f.creation.recordUsage(row.id, {
    inputTokens: 900,
    outputTokens: 900,
    cachedInputTokens: 0,
    textInputTokens: 900,
    imageInputTokens: 0,
  });
  expect(
    (await admin.tokenUsage(f.principal, "today")).today.referenceUsd,
  ).toBe(report.today.referenceUsd);
  await f.pool.query(
    "UPDATE image_attempts SET model_usage=jsonb_set(model_usage,'{cachedInputTokens}','null'::jsonb) WHERE id=$1",
    [row.id],
  );
  expect(
    (await admin.tokenUsage(f.principal, "month")).thisMonth.unknownCachedUsage,
  ).toBeGreaterThanOrEqual(1);

  await f.pool.query(
    "UPDATE image_attempts SET created_at=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' - interval '1 microsecond' WHERE id=$1",
    [row.id],
  );
  expect((await admin.tokenUsage(f.principal, "month")).thisMonth.calls).toBe(
    0,
  );
  await f.pool.query("UPDATE image_attempts SET created_at=now() WHERE id=$1", [
    row.id,
  ]);
  // Yesterday's completed call belongs to its dispatch date, not quota reservation/output day.
  await f.pool.query(
    "UPDATE image_attempts SET created_at=(now() AT TIME ZONE 'Asia/Shanghai')::date::timestamp AT TIME ZONE 'Asia/Shanghai' - interval '1 microsecond' WHERE id=$1",
    [row.id],
  );
  expect((await admin.tokenUsage(f.principal, "today")).today.calls).toBe(0);

  const unknown = await f.creation.submit(f.principal, f.input());
  // Worker will record bounded fake usage; explicitly remove only this synthetic call's evidence.
  await f.done(unknown.id);
  await f.pool.query(
    "UPDATE image_attempts SET model_usage=NULL,reference_usd=NULL WHERE task_id=$1",
    [unknown.id],
  );
  expect((await admin.tokenUsage(f.principal, "today")).today).toMatchObject({
    calls: 1,
    unknownUsage: 1,
    referenceUsd: null,
  });
  const issued = await f.service.createUser(f.principal, "token-stats-member");
  await finishTemporaryPassword(f.service, issued, testPassword);
  const login = await f.service.login(issued.user.username, testPassword);
  const member = (await f.service.authenticate(login.token)).user;
  await expect(admin.tokenUsage(member, "month")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("pins the official reference price at dispatch and records image usage without a real model call", async () => {
  const model = "gpt-image-2.5-sunburst";
  await f.creation.saveProvider(f.principal, {
    mode: "fake",
    baseUrl: "",
    models: [model],
    preserveKey: false,
    capabilities: [
      {
        model,
        generation: true,
        editing: true,
        maxReferences: 4,
        maxEdge: 3840,
        maxPixels: 8294400,
        sizes: [],
        qualities: ["low", "medium", "high"],
        formats: ["png", "jpeg", "webp"],
      },
    ],
  });
  const task = await f.creation.submit(
    f.principal,
    f.input({ model, width: 1024, height: 1024 }),
  );
  await f.worker();
  await f.done(task.id);
  const row = (
    await f.pool.query(
      "SELECT price_snapshot,reference_usd FROM image_attempts WHERE task_id=$1",
      [task.id],
    )
  ).rows[0];
  expect(row.price_snapshot).toMatchObject({
    version: "openai-standard-2026-11-02",
    input: 5,
    imageInput: 8,
    output: 30,
  });
  expect(Number(row.reference_usd)).toBeCloseTo(0.00818);
  await expect(
    f.pool.query(
      "UPDATE image_attempts SET reference_usd='NaN'::numeric WHERE task_id=$1",
      [task.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await f.creation.saveProvider(f.principal, {
    mode: "fake",
    baseUrl: "",
    models: ["test-image"],
    preserveKey: false,
  });
  expect(
    (await admin.tokenUsage(f.principal, "month")).today.referenceUsd,
  ).toBeCloseTo(0.00818);
});
it("groups all projects by account, retains inactive users and separates today/month/all-time without counting empty accounts as calls", async () => {
  const second = await f.service.createProject(f.principal, "Second project");
  const issued = await f.service.createUser(f.principal, "usage-second-user");
  await finishTemporaryPassword(f.service, issued, testPassword);
  const login = await f.service.login(issued.user.username, testPassword);
  const member = (await f.service.authenticate(login.token)).user;
  const personal = await f.service.createProject(member, "Member project");
  const empty = await f.service.createUser(f.principal, "usage-zero-user");
  const tasks = [
    await f.creation.submit(f.principal, f.input()),
    await f.creation.submit(
      f.principal,
      f.input({ projectId: second.id, count: 2 }),
    ),
    await f.creation.submit(member, f.input({ projectId: personal.id })),
  ];
  await f.worker();
  for (const task of tasks)
    await expect
      .poll(
        async () =>
          (
            await f.creation.task(
              task.projectId === personal.id ? member : f.principal,
              task.id,
            )
          ).state,
      )
      .toBe("succeeded");
  await f.service.enable(f.principal, member.id, false);
  let report = await admin.tokenUsage(f.principal, "all");
  expect(report.allTime).toMatchObject({
    calls: 4,
    inputTokens: 400,
    outputTokens: 1024,
  });
  expect(report.users.find((u) => u.id === f.principal.id)).toMatchObject({
    calls: 3,
    inputTokens: 300,
  });
  expect(report.users.find((u) => u.id === member.id)).toMatchObject({
    calls: 1,
    inputTokens: 100,
  });
  expect(report.users.find((u) => u.id === empty.user.id)).toMatchObject({
    calls: 0,
    unknownUsage: 0,
    unknownCachedUsage: 0,
    referenceUsd: 0,
  });
  expect(report.users.reduce((n, u) => n + u.calls, 0)).toBe(
    report.allTime.calls,
  );
  await f.pool.query(
    "UPDATE image_attempts SET created_at=(date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')-interval '1 microsecond' WHERE task_id=$1",
    [tasks[0].id],
  );
  report = await admin.tokenUsage(f.principal, "month");
  expect(report.today.calls).toBe(3);
  expect(report.thisMonth.calls).toBe(3);
  expect(report.allTime.calls).toBe(4);
  expect(report.users.find((u) => u.id === f.principal.id)?.calls).toBe(2);
  expect(
    (await admin.tokenUsage(f.principal, "all")).users.find(
      (u) => u.id === f.principal.id,
    )?.calls,
  ).toBe(3);
});
