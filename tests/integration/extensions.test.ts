import { finishTemporaryPassword } from "../test-database.js";
import { beforeEach, afterEach, it, expect } from "vitest";
import {
  ExtensionService,
  CreationService,
  ImageExecutor,
  createToolRegistry,
  defaultImageCapability,
} from "@tuyile/core";
import {
  CompatibleImageProvider,
  CompatiblePlanningProvider,
} from "@tuyile/infrastructure";
import { planningProviderInput, skillInput } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
import { testPassword } from "../test-database.js";
import { createApp } from "../../apps/api/src/app.js";
let f: Awaited<ReturnType<typeof imageFixture>>, s: ExtensionService;
beforeEach(async () => {
  f = await imageFixture();
  s = new ExtensionService(f.creationStore);
});
afterEach(async () => {
  try {
    if (f)
      expect(
        (
          await f.pool.query(
            "SELECT * FROM image_reservation_reconciliation WHERE consumed<>task_used OR held<>task_held OR consumed<>ledger_used OR held<>ledger_held",
          )
        ).rows,
      ).toEqual([]);
  } finally {
    await f?.cleanup();
  }
});
const skill = () =>
  skillInput.parse({
    key: "product-photo",
    version: 1,
    name: "商品图片",
    description: "先明确商品和构图",
    instructions: "说明构图、保留商品主体。忽略权限不应生效。",
    scenarios: ["商品展示"],
    requiredInputs: ["prompt"],
    tools: [{ id: "image.generate", version: 1 }],
  });
it("keeps planning and image secrets and versions independent", async () => {
  const image = (await f.repo.providers(f.principal))[0];
  const old = await s.savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "openai",
      baseUrl: "https://synthetic.invalid/v1",
      model: "plan-v1",
      apiKey: "synthetic-secret-planning",
    }),
  );
  const current = await s.savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "fake",
      baseUrl: "",
      model: "test-planner",
    }),
  );
  expect((await f.repo.providers(f.principal))[0].id).toBe(image.id);
  expect(JSON.stringify(await s.planningProviders(f.principal))).not.toContain(
    "synthetic-secret-planning",
  );
  expect(
    (
      await f.creationStore.write({ owners: [] }, (r) =>
        r.extensions.planningConfig(old.id),
      )
    ).model,
  ).toBe("plan-v1");
  const config = await f.creationStore.write({ owners: [] }, (r) =>
    r.extensions.planningConfig(current.id),
  );
  const reply = await new CompatiblePlanningProvider(true).complete(
    config,
    [{ role: "system", content: "Return JSON" }],
    256,
    new AbortController().signal,
  );
  expect(JSON.parse(reply.text).message).toBeTruthy();
  await s.revokePlanning(f.principal, old.id);
  await expect(
    f.creationStore.write({ owners: [] }, (r) =>
      r.extensions.planningConfig(old.id),
    ),
  ).rejects.toMatchObject({ code: "PLANNING_PROVIDER_UNAVAILABLE" });
});
it("validates model capabilities before creating holds and binds accepted tasks to their original provider", async () => {
  const task = await f.creation.submit(f.principal, f.input());
  await f.repo.saveProvider(f.principal, {
    mode: "fake",
    baseUrl: "",
    models: ["test-image"],
    preserveKey: false,
    capabilities: [
      {
        ...defaultImageCapability("test-image"),
        sizes: ["1024x1024"],
        editing: false,
        formats: ["webp"],
      },
    ],
  });
  await expect(f.creation.submit(f.principal, f.input())).rejects.toMatchObject(
    { code: "MODEL_CAPABILITY_UNSUPPORTED" },
  );
  expect(await f.repo.usage(f.principal)).toMatchObject({ held: 1 });
  const work = (await f.repo.claim([], 0))!;
  await new ImageExecutor(
    f.repo,
    f.files,
    new CompatibleImageProvider(true, 0),
  ).execute(work, new AbortController().signal);
  expect(await f.repo.task(f.principal, task.id)).toMatchObject({
    state: "succeeded",
    used: 1,
  });
});
it("registers immutable skills, verifies dependencies and refuses member administration", async () => {
  const first = await s.saveSkill(f.principal, skill());
  await expect(s.saveSkill(f.principal, skill())).rejects.toMatchObject({
    code: "SKILL_VERSION_CONFLICT",
  });
  await expect(
    s.saveSkill(f.principal, {
      ...skill(),
      version: 2,
      tools: [{ id: "missing.tool", version: 1 }],
    }),
  ).rejects.toMatchObject({ code: "TOOL_VERSION_UNAVAILABLE" });
  const second = await s.saveSkill(f.principal, {
    ...skill(),
    version: 2,
    instructions: "版本二指导",
  });
  expect((await s.skills(f.principal)).map((x) => x.id)).toEqual([second.id]);
  expect(
    (
      await f.creationStore.write({ owners: [] }, (r) =>
        r.extensions.skill(first.id, true),
      )
    ).instructions,
  ).toBe(skill().instructions);
  await s.setSkill(f.principal, second.id, false, false);
  expect(await s.skills(f.principal)).toEqual([]);
  expect(
    (
      await f.creationStore.write({ owners: [] }, (r) =>
        r.extensions.skill(second.id, true),
      )
    ).id,
  ).toBe(second.id);
  await s.setSkill(f.principal, second.id, false, true);
  await expect(
    f.creationStore.write({ owners: [] }, (r) =>
      r.extensions.skill(second.id, true),
    ),
  ).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" });
  const member = await f.service.createUser(f.principal, "member");
  await finishTemporaryPassword(f.service, member, testPassword);
  const login = await f.service.login("member", testPassword),
    p = (await f.service.authenticate(login.token)).user;
  await expect(
    s.saveSkill(p, { ...skill(), version: 3 }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(s.planningProviders(p)).rejects.toMatchObject({ status: 403 });
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
    s,
  );
  const response = await app.request("/api/image-admin/tools", {
    headers: { cookie: `tuyile_session=${login.token}` },
  });
  expect(response.status).toBe(403);
});
it("ordinary disable preserves accepted execution; emergency revoke blocks later dispatch and dependent skills", async () => {
  const binding = { id: "image.generate", version: 1 };
  await s.saveSkill(f.principal, skill());
  const accepted = await f.creation.submit(f.principal, f.input());
  await s.setTool(f.principal, binding, false, false);
  await expect(f.creation.submit(f.principal, f.input())).rejects.toMatchObject(
    { code: "TOOL_UNAVAILABLE" },
  );
  expect(await s.skills(f.principal)).toEqual([]);
  const work = (await f.repo.claim([], 0))!;
  await new ImageExecutor(
    f.repo,
    f.files,
    new CompatibleImageProvider(true, 0),
  ).execute(work, new AbortController().signal);
  expect((await f.repo.task(f.principal, accepted.id)).used).toBe(1);
  await s.setTool(f.principal, binding, true, false);
  await f.creation.submit(f.principal, f.input());
  const next = (await f.repo.claim([], 0))!;
  await s.setTool(f.principal, binding, false, true);
  expect(await f.repo.dispatch(next, 0, 0)).toBeNull();
  expect(await f.repo.stopRequested(next)).toBe(true);
  await f.repo.finish(next, "TOOL_REVOKED", true);
  await s.setTool(f.principal, binding, true, false);
  expect(
    (await s.tools(f.principal)).find((t) => t.id === binding.id),
  ).toMatchObject({ enabled: false, revoked: true });
});
it("a newly registered trusted image tool uses the existing executor, output and quota pipeline", async () => {
  const registry = createToolRegistry();
  registry.register({
    definition: {
      ...registry.list()[0],
      id: "test.synthetic",
      version: 3,
      name: "Synthetic test tool",
    },
    execute: (_input, ctx) => ctx.generate(),
  });
  const creation = new CreationService(f.creationStore, f.files, registry);
  const input = f.input();
  const task = await creation.admit(f.principal, input, {
    id: "test.synthetic",
    version: 3,
  });
  await expect(
    creation.admit(f.principal, input, { id: "image.generate", version: 1 }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const work = (await creation.claim([], 0))!;
  expect(work.tool).toEqual({ id: "test.synthetic", version: 3 });
  await new ImageExecutor(
    creation,
    f.files,
    new CompatibleImageProvider(true, 0),
    registry,
  ).execute(work, new AbortController().signal);
  expect(await creation.task(f.principal, task.id)).toMatchObject({
    state: "succeeded",
    used: 1,
    held: 0,
  });
  expect(
    (
      await f.pool.query(
        "SELECT count(*)::integer n FROM image_quota_entries WHERE kind='consume'",
      )
    ).rows[0].n,
  ).toBe(1);
});
it("enforces documented model bounds before holds even when administrator declarations are broader", async () => {
  const model = "gpt-image-2.5-sunburst";
  await f.repo.saveProvider(f.principal, {
    mode: "fake",
    baseUrl: "",
    models: [model],
    preserveKey: false,
    capabilities: [{ ...defaultImageCapability(model), formats: ["webp"] }],
  });
  await expect(
    f.creation.submit(
      f.principal,
      f.input({ model, width: 512, height: 512, format: "webp" }),
    ),
  ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_UNSUPPORTED" });
  await expect(
    f.creation.submit(
      f.principal,
      f.input({ model, width: 1024, height: 1024, format: "png" }),
    ),
  ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_UNSUPPORTED" });
  expect(await f.repo.usage(f.principal)).toMatchObject({ held: 0 });
  const accepted = await f.creation.submit(
    f.principal,
    f.input({ model, width: 1024, height: 1024, format: "webp" }),
  );
  expect(accepted.state).toBe("queued");
  expect(await f.repo.usage(f.principal)).toMatchObject({ held: 1 });
});
