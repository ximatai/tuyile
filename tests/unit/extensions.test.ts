import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createToolRegistry,
  defaultImageCapability,
  checkImageCapability,
} from "@tuyile/core";
import { CompatiblePlanningProvider } from "@tuyile/infrastructure";
import type { PlanningExecutionConfig } from "@tuyile/core";
const input = () => ({
  projectId: randomUUID(),
  requestKey: randomUUID(),
  prompt: "Synthetic",
  model: "test",
  width: 256,
  height: 256,
  quality: "medium" as const,
  format: "png" as const,
  count: 1,
  referenceIds: [],
});
const config: PlanningExecutionConfig = {
  mode: "openai",
  baseUrl: "https://synthetic.invalid/v1",
  apiKey: "synthetic",
  model: "test-planner",
  responseMode: "json_object",
  maxOutputTokens: 1024,
  maxInputCharacters: 1000,
};
it("rejects duplicate registrations, invalid inputs, output types and multiple model effects", async () => {
  const registry = createToolRegistry(),
    definition = { ...registry.list()[0], id: "test.tool" };
  registry.register({
    definition,
    execute: async (_input, ctx) => {
      await ctx.generate();
      return ctx.generate();
    },
  });
  expect(() =>
    registry.register({
      definition,
      execute: () => Promise.resolve(new Uint8Array([1])),
    }),
  ).toThrow("TOOL_VERSION_CONFLICT");
  expect(() =>
    registry.validate({ id: "image.edit", version: 1 }, input()),
  ).toThrow("TOOL_INPUT_UNSUPPORTED");
  let calls = 0;
  await expect(
    registry.execute(definition, input(), {
      signal: new AbortController().signal,
      generate: async () => {
        calls++;
        return new Uint8Array([1]);
      },
    }),
  ).rejects.toThrow("TOOL_EFFECT_LIMIT");
  expect(calls).toBe(1);
  registry.register({
    definition: { ...definition, version: 2 },
    execute: async (_i, c) => {
      await c.generate();
      return new Uint8Array();
    },
  });
  await expect(
    registry.execute({ ...definition, version: 2 }, input(), {
      signal: new AbortController().signal,
      generate: async () => new Uint8Array([1]),
    }),
  ).rejects.toThrow("INVALID_TOOL_OUTPUT");
});
it("checks reference, format and size capability boundaries", () => {
  const cap = {
    ...defaultImageCapability("test"),
    maxReferences: 0,
    formats: ["png" as const],
    sizes: ["256x256"],
  };
  expect(() => checkImageCapability(input(), [cap])).not.toThrow();
  for (const patch of [
    { format: "webp" as const },
    { width: 512 },
    { referenceIds: [randomUUID()] },
  ])
    expect(() => checkImageCapability({ ...input(), ...patch }, [cap])).toThrow(
      "MODEL_CAPABILITY_UNSUPPORTED",
    );
});
it("bounds planning requests and preserves unknown failures without an automatic retry", async () => {
  let calls = 0,
    body: any;
  const provider = new CompatiblePlanningProvider(false, async (_url, init) => {
    calls++;
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"steps":[]}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }),
    );
  });
  const reply = await provider.complete(
    config,
    [{ role: "system", content: "Return JSON" }],
    256,
    new AbortController().signal,
  );
  expect(reply).toEqual({
    text: '{"steps":[]}',
    inputTokens: 5,
    outputTokens: 7,
  });
  expect(body).toMatchObject({
    max_completion_tokens: 256,
    response_format: { type: "json_object" },
    stream: false,
  });
  await expect(
    provider.complete(
      config,
      [{ role: "user", content: "x".repeat(1001) }],
      256,
      new AbortController().signal,
    ),
  ).rejects.toThrow("PLANNING_BUDGET_EXCEEDED");
  expect(calls).toBe(1);
  const unknown = new CompatiblePlanningProvider(false, async () => {
    calls++;
    throw new Error("Unknown transport result");
  });
  await expect(
    unknown.complete(
      config,
      [{ role: "user", content: "JSON" }],
      256,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ kind: "unknown" });
  expect(calls).toBe(2);
  const oversized = new CompatiblePlanningProvider(
    false,
    async () => new Response("x".repeat(1024 * 1024 + 1)),
  );
  await expect(
    oversized.complete(
      config,
      [{ role: "user", content: "JSON" }],
      256,
      new AbortController().signal,
    ),
  ).rejects.toThrow("PLANNING_RESPONSE_LIMIT");
});
