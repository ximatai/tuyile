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
