import { beforeEach, afterEach, expect, it } from "vitest";
import { AgentService, ExtensionService } from "@tuyile/core";
import { planningProviderInput, planningRequest } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
let f: Awaited<ReturnType<typeof imageFixture>>, agent: AgentService;
beforeEach(async () => {
  f = await imageFixture();
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
it("atomically reserves planning once, protects references and creates no image tasks before confirmation", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const input = { ...request(), referenceIds: [asset.id] };
  const first = await agent.request(f.principal, input),
    repeated = await agent.request(f.principal, input);
  expect(repeated.id).toBe(first.id);
  expect(first.charged).toBe(false);
  expect(await agent.usage(f.principal)).toMatchObject({
    used: 0,
    held: 1,
    available: 49,
  });
  expect(await f.creation.tasks(f.principal, f.project.id)).toEqual([]);
  await expect(
    f.creation.deleteAsset(f.principal, asset.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  await expect(
    agent.request(f.principal, { ...input, prompt: "different" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await agent.jobs(f.principal, f.project.id))[0].id).toBe(first.id);
});
it("rejects planning over budget without creating jobs or changing reservations", async () => {
  await f.pool.query(
    "INSERT INTO planning_policies(user_id,daily_limit) VALUES($1,0)",
    [f.principal.id],
  );
  await expect(agent.request(f.principal, request())).rejects.toMatchObject({
    code: "PLANNING_QUOTA",
  });
  expect(await agent.jobs(f.principal, f.project.id)).toEqual([]);
  expect(await agent.usage(f.principal)).toMatchObject({
    used: 0,
    held: 0,
    available: 0,
  });
  expect((await f.pool.query("SELECT * FROM planning_days")).rows).toEqual([]);
});

it("repairs a malformed planning response once and charges only the first dispatch", async () => {
  const { PlanningExecutor } = await import("@tuyile/core");
  const job = await agent.request(f.principal, request()),
    work = (await agent.claim([]))!;
  let calls = 0;
  await new PlanningExecutor(agent, {
    complete: async () => ({
      text:
        ++calls === 1
          ? "not json"
          : JSON.stringify({ message: "请补充主体", steps: [] }),
      inputTokens: 5,
      outputTokens: 5,
    }),
  }).execute(work, new AbortController().signal);
  expect(calls).toBe(2);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
  const saved = (await agent.jobs(f.principal, f.project.id)).find(
    (j) => j.id === job.id,
  )!;
  expect(saved.state).toBe("succeeded");
  expect(saved.plans[0].document.steps).toEqual([]);
  expect(
    (
      await f.pool.query("SELECT * FROM planning_attempts WHERE job_id=$1", [
        job.id,
      ])
    ).rowCount,
  ).toBe(2);
  expect(await f.creation.tasks(f.principal, f.project.id)).toEqual([]);
});
it("does not retry unknown planning results and does not recharge interrupted work", async () => {
  const { PlanningExecutor, PlanningCallError } = await import("@tuyile/core");
  await agent.request(f.principal, request());
  let work = (await agent.claim([]))!,
    calls = 0;
  await new PlanningExecutor(agent, {
    complete: async () => {
      calls++;
      throw new PlanningCallError("unknown", "PLANNING_RESULT_UNKNOWN");
    },
  }).execute(work, new AbortController().signal);
  expect(calls).toBe(1);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
  const second = await agent.request(f.principal, request());
  work = (await agent.claim([]))!;
  await agent.dispatch(work, 100);
  await agent.startWorker();
  expect(
    (await agent.jobs(f.principal, f.project.id)).find(
      (j) => j.id === second.id,
    )?.state,
  ).toBe("failed");
  expect(await agent.claim([])).toBeNull();
  expect(await agent.usage(f.principal)).toMatchObject({ used: 2, held: 0 });
  expect(
    (
      await f.pool.query(
        "SELECT state FROM planning_attempts WHERE job_id=$1",
        [second.id],
      )
    ).rows[0].state,
  ).toBe("unknown");
});
it("permits one explicit safe 429 retry within the same reservation", async () => {
  const { PlanningExecutor, PlanningCallError } = await import("@tuyile/core");
  await agent.request(f.principal, request());
  const work = (await agent.claim([]))!;
  let calls = 0;
  await new PlanningExecutor(agent, {
    complete: async () => {
      if (++calls === 1)
        throw new PlanningCallError("rejected", "UPSTREAM_RATE_LIMIT", 429);
      return {
        text: JSON.stringify({ message: "澄清", steps: [] }),
        inputTokens: null,
        outputTokens: null,
      };
    },
  }).execute(work, new AbortController().signal);
  expect(calls).toBe(2);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
});
it("stops an in-flight planning call before releasing the shared Worker lock", async () => {
  const { ImageWorker, PlanningLane, CompatibleImageProvider } =
    await import("@tuyile/infrastructure");
  const { PlanningCallError, createToolRegistry } =
    await import("@tuyile/core");
  await agent.request(f.principal, request());
  let started!: () => void;
  const sent = new Promise<void>((r) => (started = r));
  const worker = new ImageWorker(
    f.pool,
    f.repo,
    f.files,
    new CompatibleImageProvider(true, 1),
    () => {
      throw new Error("unexpected fatal");
    },
    createToolRegistry(),
    new PlanningLane(agent, {
      complete: async (_config, _messages, _budget, signal) => {
        started();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(new PlanningCallError("unknown", "PLANNING_INTERRUPTED")),
            { once: true },
          );
        });
      },
    }),
  );
  try {
    await worker.start();
    await sent;
    await worker.stop(20);
    expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
    expect((await agent.jobs(f.principal, f.project.id))[0].state).toBe(
      "failed",
    );
  } finally {
    await worker.stop(20);
  }
});

async function draft(count = 1, dependent = true) {
  const { PlanningExecutor } = await import("@tuyile/core");
  const { projectId, requestKey, ...spec } = f.input({ count });
  const document = {
    message: "合成两步计划",
    steps: [
      {
        ...spec,
        title: "基准",
        tool: { id: "image.generate", version: 1 },
        usePrevious: false,
      },
      {
        ...spec,
        title: "改图",
        tool: { id: dependent ? "image.edit" : "image.generate", version: 1 },
        usePrevious: dependent,
      },
    ],
  };
  const job = await agent.request(f.principal, request());
  const work = (await agent.claim([]))!;
  await new PlanningExecutor(agent, {
    complete: async () => ({
      text: JSON.stringify(document),
      inputTokens: 5,
      outputTokens: 5,
    }),
  }).execute(work, new AbortController().signal);
  return (await agent.jobs(f.principal, f.project.id)).find(
    (j) => j.id === job.id,
  )!.plans[0];
}
it("rolls back the entire confirmed plan if its final step exceeds the image budget", async () => {
  const plan = await draft();
  const policy = await f.repo.getPolicy(f.principal, f.principal.id);
  await f.repo.setPolicy(f.principal, f.principal.id, {
    ...policy,
    imageLimit: 1,
  });
  await expect(agent.confirm(f.principal, plan.id)).rejects.toMatchObject({
    code: "IMAGE_QUOTA",
  });
  expect(await f.repo.tasks(f.principal, f.project.id)).toEqual([]);
  expect((await f.repo.usage(f.principal)).held).toBe(0);
  expect(
    (await f.pool.query("SELECT * FROM image_quota_reservations")).rows,
  ).toEqual([]);
  expect(
    (await agent.jobs(f.principal, f.project.id))[0].plans[0].confirmed,
  ).toBe(false);
});
it("confirms once and executes dependent image steps with persistent source lineage", async () => {
  const plan = await draft();
  const tasks = await agent.confirm(f.principal, plan.id);
  expect(tasks).toHaveLength(2);
  expect((await agent.confirm(f.principal, plan.id)).map((t) => t.id)).toEqual(
    tasks.map((t) => t.id),
  );
  expect((await f.repo.usage(f.principal)).held).toBe(2);
  await f.worker();
  const first = await f.done(tasks[0].id),
    second = await f.done(tasks[1].id);
  expect(first.state).toBe("succeeded");
  expect(second.state).toBe("succeeded");
  expect(
    (
      await f.pool.query(
        "SELECT asset_id FROM image_output_sources WHERE output_id=$1",
        [second.outputs[0].outputId],
      )
    ).rows.map((r) => r.asset_id),
  ).toEqual([first.outputs[0].id]);
  expect(await f.repo.usage(f.principal)).toMatchObject({ used: 2, held: 0 });
});
it("releases later steps after dependency failure and does not resume a started plan on restart", async () => {
  let plan = await draft(),
    tasks = await agent.confirm(f.principal, plan.id);
  let first = (await f.repo.claim([], 0))!;
  await f.repo.finish(first, "SYNTHETIC_FAILURE");
  expect(await f.repo.claim([], 0)).toBeNull();
  expect((await f.repo.task(f.principal, tasks[1].id)).state).toBe("cancelled");
  expect((await f.repo.usage(f.principal)).held).toBe(0);
  plan = await draft();
  tasks = await agent.confirm(f.principal, plan.id);
  first = (await f.repo.claim([], 0))!;
  await f.repo.startWorker();
  expect((await f.repo.task(f.principal, tasks[0].id)).state).toBe("failed");
  expect((await f.repo.task(f.principal, tasks[1].id)).state).toBe("failed");
  expect(await f.repo.claim([], 0)).toBeNull();
  expect((await f.repo.usage(f.principal)).held).toBe(0);
});
it("authenticates Agent HTTP commands, checks CSRF and accepts bounded Chinese planning requests", async () => {
  const { createApp } = await import("../../apps/api/src/app.js");
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
    undefined,
    undefined,
    agent,
  );
  expect((await app.request("/api/agent/usage")).status).toBe(401);
  const session = await f.service.authenticate(f.login.token);
  const headers = {
    cookie: `tuyile_session=${f.login.token}`,
    Origin: "http://127.0.0.1:5180",
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  };
  const body = JSON.stringify({ ...request(), prompt: "合成".repeat(4000) });
  expect(
    (
      await app.request("/api/agent/planning", {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "invalid" },
        body,
      })
    ).status,
  ).toBe(403);
  const response = await app.request("/api/agent/planning", {
    method: "POST",
    headers,
    body,
  });
  expect(response.status).toBe(202);
  const accepted = await response.json();
  expect(accepted.state).toBe("queued");
  expect(
    (
      await (
        await app.request("/api/agent/planning", {
          method: "POST",
          headers,
          body,
        })
      ).json()
    ).id,
  ).toBe(accepted.id);
  expect(await f.repo.tasks(f.principal, f.project.id)).toEqual([]);
});
it("cancels unstarted planning and complete accepted plans without duplicate releases", async () => {
  const pending = await agent.request(f.principal, request());
  await agent.cancelJob(f.principal, pending.id);
  await agent.cancelJob(f.principal, pending.id);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 0, held: 0 });
  expect(await agent.claim([])).toBeNull();
  const plan = await draft();
  const tasks = await agent.confirm(f.principal, plan.id);
  await agent.cancelPlan(f.principal, plan.id);
  await agent.cancelPlan(f.principal, plan.id);
  for (const task of tasks)
    expect((await f.repo.task(f.principal, task.id)).state).toBe("cancelled");
  expect(await f.repo.usage(f.principal)).toMatchObject({ used: 0, held: 0 });
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
});

it("bounds history to the latest 50 immutable versions without losing earlier plan lookup", async () => {
  const first = await draft();
  for (let i = 0; i < 51; i++) {
    await agent.revise(f.principal, first.jobId, {
      requestKey: crypto.randomUUID(),
      document: { ...first.document, message: `Revision ${i}` },
    });
  }
  const job = (await agent.jobs(f.principal, f.project.id))[0];
  expect(job.plans).toHaveLength(50);
  expect(job.plans[0].version).toBe(3);
  expect(job.plans.at(-1)?.version).toBe(52);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
  const tasks = await agent.confirm(f.principal, first.id);
  expect(tasks).toHaveLength(2);
});

it("retains original requests across clarification and pins inherited reference previews without persisting image bytes", async () => {
  const { PlanningExecutor } = await import("@tuyile/core");
  const { CompatiblePlanningProvider } = await import("@tuyile/infrastructure");
  await new ExtensionService(f.creationStore).savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "openai",
      baseUrl: "https://synthetic.invalid/v1",
      model: "synthetic-vision",
      apiKey: "synthetic-key",
      supportsImages: true,
    }),
  );
  const reference = await f.creation.upload(f.principal, f.png);
  const first = await agent.request(f.principal, {
    ...request(),
    prompt: "为参考商品设计咖啡包装 ORIGINAL_SUBJECT",
    referenceIds: [reference.id],
  });
  const captured: any[] = [];
  const provider = new CompatiblePlanningProvider(
    false,
    async (_url, options) => {
      captured.push(JSON.parse(options!.body as string));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ message: "请选择配色", steps: [] }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200 },
      );
    },
  );
  const work = (await agent.claim([]))!;
  await new PlanningExecutor(agent, provider).execute(
    work,
    new AbortController().signal,
  );
  const plan = (await agent.jobs(f.principal, f.project.id))[0].plans[0];
  const next = await agent.request(f.principal, {
    ...request(),
    prompt: "蓝色",
    previousPlanId: plan.id,
  });
  const second = (await agent.claim([]))!;
  expect(second.id).toBe(next.id);
  expect(JSON.stringify(second.messages)).toContain("ORIGINAL_SUBJECT");
  expect(JSON.stringify(second.messages)).toContain("请选择配色");
  expect(JSON.stringify(second.messages)).toContain("蓝色");
  await new PlanningExecutor(agent, provider).execute(
    second,
    new AbortController().signal,
  );
  expect(captured).toHaveLength(2);
  for (const body of captured) {
    const parts = body.messages.flatMap((m: any) =>
      Array.isArray(m.content) ? m.content : [],
    );
    const image = parts.find((p: any) => p.type === "image_url");
    expect(image.image_url.url).toMatch(/^data:image\/webp;base64,/);
    expect(parts.some((p: any) => p.text?.includes(reference.id))).toBe(true);
    const bytes = Buffer.from(image.image_url.url.split(",")[1], "base64");
    const stored = await f.creation.asset(f.principal, reference.id);
    expect(bytes).toEqual(Buffer.from(await f.files.read(stored, true)));
  }
  expect(
    (
      await f.pool.query(
        "SELECT asset_id FROM agent_references WHERE job_id=$1",
        [next.id],
      )
    ).rows,
  ).toEqual([{ asset_id: reference.id }]);
  const persisted = JSON.stringify(
    (
      await f.pool.query(
        "SELECT messages FROM planning_jobs WHERE id=ANY($1::uuid[])",
        [[first.id, next.id]],
      )
    ).rows,
  );
  expect(persisted).not.toContain("base64");
  expect(persisted).not.toContain("synthetic-key");
  expect(await agent.usage(f.principal)).toMatchObject({ used: 2, held: 0 });
});
it("rejects image planning on a text-only model before reserving or dispatching", async () => {
  await new ExtensionService(f.creationStore).savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "openai",
      baseUrl: "https://synthetic.invalid/v1",
      model: "text-only",
      apiKey: "synthetic-key",
    }),
  );
  const asset = await f.creation.upload(f.principal, f.png);
  await expect(
    agent.request(f.principal, { ...request(), referenceIds: [asset.id] }),
  ).rejects.toMatchObject({ code: "PLANNING_IMAGES_UNSUPPORTED" });
  expect(await agent.jobs(f.principal, f.project.id)).toEqual([]);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 0, held: 0 });
});
it("counts inherited clarification context toward the next request input budget", async () => {
  const { PlanningExecutor } = await import("@tuyile/core");
  await agent.request(f.principal, {
    ...request(),
    prompt: "Original " + "a".repeat(3000),
  });
  await new PlanningExecutor(agent, {
    complete: async () => ({
      text: JSON.stringify({ message: "Which color?", steps: [] }),
      inputTokens: 1,
      outputTokens: 1,
    }),
  }).execute((await agent.claim([]))!, new AbortController().signal);
  const plan = (await agent.jobs(f.principal, f.project.id))[0].plans[0];
  await new ExtensionService(f.creationStore).savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "fake",
      baseUrl: "",
      model: "smaller-budget",
      maxInputCharacters: 1000,
    }),
  );
  await expect(
    agent.request(f.principal, {
      ...request(),
      prompt: "Blue",
      previousPlanId: plan.id,
    }),
  ).rejects.toMatchObject({ code: "PLANNING_BUDGET_EXCEEDED" });
  expect(await agent.jobs(f.principal, f.project.id)).toHaveLength(1);
  expect(await agent.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
});
