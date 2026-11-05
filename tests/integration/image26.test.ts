import { expect, it } from "vitest";
import { AgentService, ExtensionService, PlanningExecutor } from "@tuyile/core";
import { CompatiblePlanningProvider } from "@tuyile/infrastructure";
import {
  imageCapabilityDefaults,
  planningProviderInput,
  planningRequest,
} from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
it("pins 2.6 complexity through admission, edits, planning and confirmation without changing legacy inputs", async () => {
  const f = await imageFixture();
  try {
    const model = "gpt-image-2.6-flare";
    await f.creation.saveProvider(f.principal, {
      mode: "fake",
      baseUrl: "",
      models: [model],
      preserveKey: false,
      capabilities: [
        {
          ...imageCapabilityDefaults(model),
          maxEdge: 3840,
          maxPixels: 8294400,
          complexities: ["low", "medium"],
        },
      ],
    });
    const input = f.input({
      model,
      width: 1024,
      height: 1024,
      complexity: "low",
    });
    const task = await f.creation.submit(f.principal, input);
    expect(task.settings?.complexity).toBe("low");
    expect((await f.creation.submit(f.principal, input)).id).toBe(task.id);
    await expect(
      f.creation.submit(f.principal, { ...input, complexity: "medium" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      f.creation.submit(
        f.principal,
        f.input({ model, width: 1024, height: 1024, complexity: "high" }),
      ),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_UNSUPPORTED" });
    const legacy = await f.creation.submit(
      f.principal,
      f.input({ model, width: 1024, height: 1024 }),
    );
    expect(legacy.settings?.complexity).toBeUndefined();
    const asset = await f.creation.upload(f.principal, f.png);
    const edit = await f.creation.submit(
      f.principal,
      f.input({
        model,
        width: 1024,
        height: 1024,
        complexity: "medium",
        referenceIds: [asset.id],
      }),
    );
    await f.worker();
    expect((await f.done(task.id)).state).toBe("succeeded");
    expect((await f.done(edit.id)).settings?.complexity).toBe("medium");
    await new ExtensionService(f.creationStore).savePlanning(
      f.principal,
      planningProviderInput.parse({
        mode: "fake",
        baseUrl: "",
        model: "planner",
      }),
    );
    const agent = new AgentService(f.creationStore, f.files);
    const { count, ...planningInput } = f.input({
      model,
      width: 1024,
      height: 1024,
      complexity: "low",
    });
    const job = await agent.request(
      f.principal,
      planningRequest.parse(planningInput),
    );
    const work = (await agent.claim([]))!;
    await new PlanningExecutor(
      agent,
      new CompatiblePlanningProvider(true),
    ).execute(work, new AbortController().signal);
    const plan = (await agent.jobs(f.principal, f.project.id)).find(
      (j) => j.id === job.id,
    )!.plans[0]!;
    expect(plan.document.steps[0]?.complexity).toBe("low");
    await agent.confirm(f.principal, plan.id);
    expect(
      (await f.creation.tasks(f.principal, f.project.id)).some(
        (t) => t.settings?.complexity === "low" && t.id !== task.id,
      ),
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
});
