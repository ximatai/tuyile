import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CanvasService,
  AgentService,
  ExtensionService,
  PlanningExecutor,
} from "@tuyile/core";
import { PgCanvasStore } from "@tuyile/infrastructure";
import {
  emptyCanvas,
  planningProviderInput,
  imageInput,
} from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture";
let f: Awaited<ReturnType<typeof imageFixture>>, canvas: CanvasService;
const a = randomUUID(),
  b = randomUUID();
let revision = 0;
async function save(texts = ["山间开业", "慢慢相遇"]) {
  const result = await canvas.save(f.principal, f.project.id, {
    revision,
    requestKey: randomUUID(),
    placements: [],
    document: {
      ...emptyCanvas(),
      nodes: texts.map((text, i) => ({
        id: i ? b : a,
        kind: "text" as const,
        label: i ? "副标题" : "主标题",
        text,
        tone: "plain" as const,
        x: i * 320,
        y: 0,
        width: 300,
        height: 200,
      })),
    },
  });
  revision = result.revision;
  return result;
}
beforeEach(async () => {
  f = await imageFixture();
  canvas = new CanvasService(new PgCanvasStore(f.pool));
  revision = 0;
});
afterEach(async () => {
  await f?.cleanup();
});
it("resolves ordered same-project text once, freezes actual provider input, and keeps retries valid after deletion", async () => {
  await save();
  const input = imageInput.parse({
    ...f.input(),
    textNodeIds: [b, a],
    textCanvasRevision: revision,
    textSources: [{ nodeId: a, title: "forged", text: "forged" }],
  });
  const task = await f.creation.submit(f.principal, input);
  expect(task.textSources?.map((s) => s.text)).toEqual([
    "慢慢相遇",
    "山间开业",
  ]);
  expect(task.finalPrompt).toContain("引用文案 1（副标题）：\n慢慢相遇");
  await save(["已修改", "新文案"]);
  expect((await f.creation.submit(f.principal, input)).id).toBe(task.id);
  const next = await f.creation.submit(f.principal, {
    ...input,
    textCanvasRevision: revision,
    requestKey: randomUUID(),
  });
  expect(next.textSources?.[1].text).toBe("已修改");
  await save([]);
  expect((await f.creation.submit(f.principal, input)).textSources).toEqual(
    task.textSources,
  );
  const before = await f.creation.usage(f.principal);
  await expect(
    f.creation.submit(f.principal, {
      ...input,
      textCanvasRevision: revision,
      requestKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "TEXT_REFERENCE_UNAVAILABLE" });
  expect((await f.creation.usage(f.principal)).held).toBe(before.held);
  const actual: string[] = [];
  await f.worker({
    generate: async (_config, spec) => {
      actual.push(spec.prompt);
      return f.png;
    },
  });
  await f.done(next.id);
  expect(actual).toHaveLength(2);
  expect(actual.some((text) => text.includes("山间开业"))).toBe(true);
  expect(actual.some((text) => text.includes("已修改"))).toBe(true);
  expect((await f.creation.task(f.principal, task.id)).textSources).toEqual(
    task.textSources,
  );
  await canvas.removeProject(f.principal, f.project.id);
  const retained = (
    await f.pool.query("SELECT input FROM image_tasks WHERE id=$1", [task.id])
  ).rows[0].input;
  expect(retained.textSources).toBeUndefined();
  expect(retained.textNodeIds).toBeUndefined();
  expect(retained.finalPrompt).toBeUndefined();
  expect(retained.prompt).toBe("");
});
it("rejects other-project/empty text and overlong combinations without reserving quota", async () => {
  await save(["", "b".repeat(4000)]);
  const other = await f.service.createProject(f.principal, "other");
  for (const extra of [
    { textNodeIds: [a] },
    { projectId: other.id, textNodeIds: [b] },
    { textNodeIds: [b], prompt: "p".repeat(10000) },
  ]) {
    await expect(
      f.creation.submit(
        f.principal,
        f.input({
          ...extra,
          textCanvasRevision: "projectId" in extra ? 0 : revision,
        }),
      ),
    ).rejects.toMatchObject({
      code:
        "prompt" in extra ? "PROMPT_TOO_LONG" : "TEXT_REFERENCE_UNAVAILABLE",
    });
  }
  expect((await f.creation.usage(f.principal)).held).toBe(0);
});
it("uses immutable planning text through plan revision/confirmation after source removal", async () => {
  await save();
  const agent = new AgentService(f.creationStore, f.files);
  await new ExtensionService(f.creationStore).savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "fake",
      baseUrl: "",
      model: "test-planner",
    }),
  );
  const { count, ...spec } = f.input({
    textNodeIds: [a, b],
    textCanvasRevision: revision,
  });
  const job = await agent.request(f.principal, spec);
  const work = (await agent.claim([]))!;
  expect(JSON.stringify(work.messages)).toContain("山间开业");
  const { projectId, requestKey, textNodeIds, textCanvasRevision, ...step } =
    f.input();
  await new PlanningExecutor(agent, {
    complete: async () => ({
      inputTokens: 1,
      outputTokens: 1,
      text: JSON.stringify({
        message: "合成海报",
        steps: [
          {
            ...step,
            title: "海报",
            tool: { id: "image.generate", version: 1 },
            usePrevious: false,
          },
        ],
      }),
    }),
  }).execute(work, new AbortController().signal);
  const ready = (await agent.jobs(f.principal, f.project.id))[0];
  expect(ready.state).toBe("succeeded");
  await save([]);
  expect((await agent.request(f.principal, spec)).id).toBe(job.id);
  const revised = await agent.revise(f.principal, job.id, {
    requestKey: randomUUID(),
    document: { ...ready.plans[0].document, message: "验收后的方案" },
  });
  const tasks = await agent.confirm(f.principal, revised.id);
  expect(tasks[0].textSources?.map((s) => s.text)).toEqual([
    "山间开业",
    "慢慢相遇",
  ]);
  expect(tasks[0].finalPrompt).toContain("山间开业");
});

it("rejects stale and missing preview revisions before image/planning reservations, but recovers accepted requests", async () => {
  await save();
  const agent = new AgentService(f.creationStore, f.files);
  await new ExtensionService(f.creationStore).savePlanning(
    f.principal,
    planningProviderInput.parse({
      mode: "fake",
      baseUrl: "",
      model: "test-planner",
    }),
  );
  const input = f.input({ textNodeIds: [a], textCanvasRevision: revision });
  const { count, ...planning } = input;
  const accepted = await f.creation.submit(f.principal, input);
  const acceptedJob = await agent.request(f.principal, planning);
  await save(["新文案", "新副标题"]);
  const imageHeld = (await f.creation.usage(f.principal)).held;
  const planningHeld = (await agent.usage(f.principal)).held;
  for (const textCanvasRevision of [undefined, revision - 1, revision + 1]) {
    await expect(
      f.creation.submit(f.principal, {
        ...input,
        requestKey: randomUUID(),
        textCanvasRevision,
      }),
    ).rejects.toMatchObject({ code: "TEXT_REFERENCE_CONFLICT" });
    await expect(
      agent.request(f.principal, {
        ...planning,
        requestKey: randomUUID(),
        textCanvasRevision,
      }),
    ).rejects.toMatchObject({ code: "TEXT_REFERENCE_CONFLICT" });
  }
  expect((await f.creation.usage(f.principal)).held).toBe(imageHeld);
  expect((await agent.usage(f.principal)).held).toBe(planningHeld);
  expect(await f.creation.tasks(f.principal, f.project.id)).toHaveLength(1);
  expect(await agent.jobs(f.principal, f.project.id)).toHaveLength(1);
  expect((await f.creation.submit(f.principal, input)).id).toBe(accepted.id);
  expect((await agent.request(f.principal, planning)).id).toBe(acceptedJob.id);
  const updated = await f.creation.submit(f.principal, {
    ...input,
    requestKey: randomUUID(),
    textCanvasRevision: revision,
  });
  expect(updated.textSources?.[0].text).toBe("新文案");
  const updatedJob = await agent.request(f.principal, {
    ...planning,
    requestKey: randomUUID(),
    textCanvasRevision: revision,
  });
  expect(updatedJob.textSources?.[0].text).toBe("新文案");
});

it("persists the five note colors including pink through canvas saves", async () => {
  const initial = await save();
  const updated = await canvas.save(f.principal, f.project.id, {
    revision,
    requestKey: randomUUID(),
    placements: [],
    document: {
      ...initial.document,
      nodes: initial.document.nodes.map((node) => ({ ...node, tone: "pink" })),
    },
  });
  expect(
    (await canvas.load(f.principal, f.project.id)).document.nodes.every(
      (node) => node.tone === "pink",
    ),
  ).toBe(true);
  expect(updated.revision).toBe(revision + 1);
});
