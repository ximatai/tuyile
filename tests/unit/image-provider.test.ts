import { it, expect } from "vitest";
import { CompatibleImageProvider } from "@tuyile/infrastructure";
import { checkImageSpec, defaultImagePolicy, shanghaiDay } from "@tuyile/core";
import type { ImageInput, ProviderInput } from "@tuyile/contracts";
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
const config: ProviderInput = {
  mode: "openai",
  baseUrl: "https://provider.invalid/v1",
  models: ["compatible-model"],
  apiKey: "synthetic-only",
  preserveKey: false,
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
