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
  admin = new AdministrationService(new PgAdministrationStore(f.pool));
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
  await f.service.redeem(created.token, testPassword, "activate");
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
