import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { AgentService, ExtensionService, PlanningExecutor } from "@tuyile/core";
import { planningProviderInput, planningRequest } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";

it("executes A once then binds its chosen output for B/C with immutable, idempotent selection", async () => {
  const f = await imageFixture();
  try {
    const agent = new AgentService(f.creationStore, f.files);
    await new ExtensionService(f.creationStore).savePlanning(
      f.principal,
      planningProviderInput.parse({
        mode: "fake",
        baseUrl: "",
        model: "planner",
      }),
    );
    const { count, ...input } = f.input();
    const job = await agent.request(
      f.principal,
      planningRequest.parse({ ...input, preserveRequirements: "保留主体颜色" }),
    );
    const work = (await agent.claim([]))!;
    const step = {
      title: "A",
      prompt: "Synthetic",
      model: "test-image",
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      count: 1,
      referenceIds: [],
      tool: { id: "image.generate", version: 1 },
      usePrevious: false,
    };
    await new PlanningExecutor(agent, {
      complete: async () => ({
        text: JSON.stringify({
          message: "先选定主视觉再衍生",
          steps: [
            step,
            {
              ...step,
              title: "B",
              tool: { id: "image.edit", version: 1 },
              usePrevious: true,
            },
            { ...step, title: "C" },
          ],
        }),
        inputTokens: 1,
        outputTokens: 1,
      }),
    }).execute(work, new AbortController().signal);
    const plan = (await agent.jobs(f.principal, f.project.id)).find(
      (j) => j.id === job.id,
    )!.plans[0];
    const [a, b, c] = plan.document.steps;
    const selectedA = {
      requestKey: randomUUID(),
      stepIds: [a.id!],
      bindings: [],
    };
    const first = await agent.select(f.principal, plan.id, selectedA);
    expect((await agent.select(f.principal, plan.id, selectedA)).id).toBe(
      first.id,
    );
    const [taskA] = await agent.confirm(f.principal, first.id);
    expect(taskA.prompt).toContain("保留主体颜色");
    await f.worker();
    const output = (await f.done(taskA.id)).outputs[0];
    const continuation = {
      requestKey: randomUUID(),
      stepIds: [b.id!, c.id!],
      bindings: [{ stepId: a.id!, assetId: output.id }],
    };
    const second = await agent.select(f.principal, plan.id, continuation);
    const accepted = await agent.confirm(f.principal, second.id);
    expect(accepted).toHaveLength(2);
    expect(accepted[0].settings?.referenceIds).toContain(output.id);
    expect(
      (await agent.confirm(f.principal, second.id)).map((t) => t.id),
    ).toEqual(accepted.map((t) => t.id));
    await expect(
      agent.select(f.principal, plan.id, {
        ...continuation,
        stepIds: [c.id!],
        bindings: [],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    for (const task of accepted)
      expect((await f.done(task.id)).state).toBe("succeeded");
    expect(await f.creation.tasks(f.principal, f.project.id)).toHaveLength(3);
    expect((await f.creation.usage(f.principal)).used).toBe(3);
    expect(
      (await agent.jobs(f.principal, f.project.id))[0].plans[0].confirmed,
    ).toBe(false);
  } finally {
    await f.cleanup();
  }
});

it("anchors confirmed derivatives to the selected work or its completed derivative", async () => {
  const f = await imageFixture();
  try {
    const agent = new AgentService(f.creationStore, f.files);
    await new ExtensionService(f.creationStore).savePlanning(
      f.principal,
      planningProviderInput.parse({
        mode: "fake",
        baseUrl: "",
        model: "planner",
      }),
    );
    const source = await f.creation.upload(f.principal, f.png);
    const unrelated = await f.creation.upload(f.principal, f.png);
    const derivation = { id: randomUUID(), assetId: source.id };
    const { count, ...input } = f.input({ referenceIds: [source.id] });
    expect(() =>
      agent.request(f.principal, { ...input, referenceIds: [], derivation }),
    ).toThrow("DERIVATION_SOURCE_REQUIRED");
    const job = await agent.request(f.principal, { ...input, derivation });
    const work = (await agent.claim([]))!;
    const step = {
      title: "横版陈列",
      prompt: "新增横版配图",
      model: "test-image",
      width: 256,
      height: 256,
      quality: "medium" as const,
      format: "png" as const,
      count: 1,
      referenceIds: [source.id],
      tool: { id: "image.edit", version: 1 },
      usePrevious: false,
    };
    await new PlanningExecutor(agent, {
      complete: async () => ({
        text: JSON.stringify({
          message: "新增配套素材",
          steps: [
            step,
            { ...step, title: "适配方版", referenceIds: [], usePrevious: true },
            { ...step, title: "无关素材", referenceIds: [unrelated.id] },
          ],
        }),
        inputTokens: 1,
        outputTokens: 1,
      }),
    }).execute(work, new AbortController().signal);
    const finished = (await agent.jobs(f.principal, f.project.id)).find(
      (j) => j.id === job.id,
    )!;
    expect(finished.derivation).toEqual(derivation);
    const [plan] = finished.plans;
    const [a, b] = plan.document.steps;
    await expect(
      agent.request(f.principal, {
        ...input,
        requestKey: randomUUID(),
        previousPlanId: plan.id,
        derivation: { ...derivation, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "DERIVATION_CONTEXT_MISMATCH" });
    await expect(agent.confirm(f.principal, plan.id)).rejects.toMatchObject({
      code: "DERIVATION_SOURCE_REQUIRED",
    });
    expect(await f.creation.tasks(f.principal, f.project.id)).toHaveLength(0);
    const first = await agent.select(f.principal, plan.id, {
      requestKey: randomUUID(),
      stepIds: [a.id!],
      bindings: [],
    });
    const [accepted] = await agent.confirm(f.principal, first.id);
    expect(accepted.settings?.referenceIds).toEqual([source.id]);
    await f.worker();
    const output = (await f.done(accepted.id)).outputs[0];
    const selectB = (assetId: string) =>
      agent.select(f.principal, plan.id, {
        requestKey: randomUUID(),
        stepIds: [b.id!],
        bindings: [{ stepId: a.id!, assetId }],
      });
    const wrong = await selectB(unrelated.id);
    await expect(agent.confirm(f.principal, wrong.id)).rejects.toMatchObject({
      code: "DERIVATION_SOURCE_REQUIRED",
    });
    const next = await selectB(output.id);
    const [continued] = await agent.confirm(f.principal, next.id);
    expect(continued.settings?.referenceIds).toEqual([output.id]);
    expect((await f.done(continued.id)).state).toBe("succeeded");
    expect(await f.creation.tasks(f.principal, f.project.id)).toHaveLength(2);
    expect((await f.creation.usage(f.principal)).used).toBe(2);
  } finally {
    await f.cleanup();
  }
});
