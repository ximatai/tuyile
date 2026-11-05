import { it, expect } from "vitest";
import { CompatibleImageProvider } from "@tuyile/infrastructure";
import { checkImageSpec, defaultImagePolicy, shanghaiDay } from "@tuyile/core";
import type { ImageInput } from "@tuyile/contracts";
import type { ImageExecutionConfig } from "@tuyile/core";
const input: ImageInput = {
  projectId: "",
  requestKey: "",
  prompt: "synthetic",
  model: "compatible-model",
  width: 2048,
  height: 1024,
  quality: "high",
  format: "webp",
  count: 2,
  referenceIds: [],
};
const config: ImageExecutionConfig = {
  mode: "openai",
  baseUrl: "https://provider.invalid/v1",
  apiKey: "synthetic-only",
};
it("uses flexible image sizes and one-image dispatches without unsupported response_format", async () => {
  const p = new CompatibleImageProvider(false, 0, async (url, options) => {
    expect(String(url)).toBe("https://provider.invalid/v1/images/generations");
    expect(JSON.parse(String(options?.body))).toEqual({
      model: input.model,
      prompt: "synthetic",
      size: "2048x1024",
      quality: "high",
      output_format: "webp",
      n: 1,
    });
    return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
  });
  expect(
    Buffer.from(
      await p.generate(config, input, [], new AbortController().signal),
    ).toString(),
  ).toBe("hello");
});
it("uses multipart edits and refuses remote result URLs rather than fetching them", async () => {
  const p = new CompatibleImageProvider(false, 0, async (url, options) => {
    expect(String(url)).toContain("/images/edits");
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options!.body as FormData).getAll("image[]")).toHaveLength(1);
    return new Response(
      JSON.stringify({ data: [{ url: "https://private.invalid/image" }] }),
    );
  });
  await expect(
    p.generate(
      config,
      input,
      [new Uint8Array([0x89, 1])],
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ kind: "unknown", code: "UNSUPPORTED_RESPONSE" });
});
it("classifies errors conservatively and never implicitly retries transport failures", async () => {
  let calls = 0;
  const p = new CompatibleImageProvider(false, 0, async () => {
    calls++;
    throw new Error("network");
  });
  await expect(
    p.generate(config, input, [], new AbortController().signal),
  ).rejects.toMatchObject({ kind: "unknown" });
  expect(calls).toBe(1);
  for (const status of [400, 429, 500, 408]) {
    const provider = new CompatibleImageProvider(
      false,
      0,
      async () => new Response("", { status }),
    );
    await expect(
      provider.generate(config, input, [], new AbortController().signal),
    ).rejects.toMatchObject({
      kind: [400, 429].includes(status) ? "rejected" : "unknown",
      status,
    });
  }
});
it("uses Shanghai day boundaries and validates all-order model/spec limits", () => {
  expect(shanghaiDay(new Date("2026-10-29T16:00:00Z"))).toBe("2026-10-30");
  expect(() =>
    checkImageSpec({ ...input, count: 5 }, defaultImagePolicy, [
      "compatible-model",
    ]),
  ).toThrow("SPEC_LIMIT");
  expect(() => checkImageSpec(input, defaultImagePolicy, ["other"])).toThrow(
    "MODEL_NOT_ALLOWED",
  );
});
it("retains usage evidence even when the returned image payload is invalid", async () => {
  const usage: import("@tuyile/core").ModelUsage[] = [];
  const p = new CompatibleImageProvider(
    false,
    0,
    async () =>
      new Response(
        JSON.stringify({
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            input_tokens_details: { text_tokens: 10, image_tokens: 0 },
          },
          data: [{ url: "https://synthetic.invalid/image" }],
        }),
      ),
  );
  await expect(
    p.generate(config, input, [], new AbortController().signal, async (u) => {
      usage.push(u);
    }),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_RESPONSE" });
  expect(usage).toEqual([
    expect.objectContaining({ inputTokens: 10, outputTokens: 20 }),
  ]);
});

it("sends explicit complexity in generation JSON and edit multipart but omits legacy defaults", async () => {
  for (const editing of [false, true]) {
    const provider = new CompatibleImageProvider(
      false,
      0,
      async (_url, options) => {
        if (editing)
          expect((options!.body as FormData).get("complexity")).toBe("low");
        else expect(JSON.parse(String(options?.body)).complexity).toBe("low");
        return new Response(
          JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }),
        );
      },
    );
    await provider.generate(
      config,
      { ...input, complexity: "low" },
      editing ? [new Uint8Array([0x89, 1])] : [],
      new AbortController().signal,
    );
  }
});

it("dispatches the exact persisted prompt once without recomposing requirements or runtime text snapshots", async () => {
  const { imageDispatchInput } = await import("@tuyile/core");
  const { composeCreativePrompt } = await import("@tuyile/contracts");
  const value = {
    ...input,
    projectId: "00000000-0000-4000-8000-000000000001",
    requestKey: "00000000-0000-4000-8000-000000000002",
    style: { name: "Style", text: "Soft light" },
    preserveRequirements: "Keep the subject",
    textSources: [{ nodeId: "n", title: "Copy", text: "Exact copy  \n" }],
  };
  const finalPrompt = composeCreativePrompt(value);
  const wire = imageDispatchInput(value, finalPrompt);
  expect(wire.style).toBeUndefined();
  expect(wire.preserveRequirements).toBeUndefined();
  expect(wire).not.toHaveProperty("textSources");
  const p = new CompatibleImageProvider(false, 0, async (_url, options) => {
    expect(JSON.parse(String(options?.body)).prompt).toBe(finalPrompt);
    return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
  });
  await p.generate(config, wire, [], new AbortController().signal);
  const trailing = composeCreativePrompt({ ...value, style: undefined });
  await new CompatibleImageProvider(false, 0, async (_url, options) => {
    expect(JSON.parse(String(options?.body)).prompt).toBe(trailing);
    return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
  }).generate(
    config,
    imageDispatchInput({ ...value, style: undefined }, trailing),
    [],
    new AbortController().signal,
  );
});
