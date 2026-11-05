import { it, expect } from "vitest";
import { parseModelUsage, referencePrice, referenceCost } from "@tuyile/core";
it("separates cached input without double counting reasoning output and snapshots standard rates", () => {
  const usage = parseModelUsage(
    {
      prompt_tokens: 1000000,
      completion_tokens: 100000,
      prompt_tokens_details: { cached_tokens: 200000 },
      completion_tokens_details: { reasoning_tokens: 50000 },
    },
    "planning",
  );
  expect(
    referenceCost(usage, referencePrice("gpt-6.1-terra", "planning")),
  ).toBeCloseTo(2.37);
  expect(referencePrice("proxy/gpt-6.1-terra", "planning")).toBeNull();
});
it("charges image text and image input separately without a Responses-only cache discount", () => {
  const usage = parseModelUsage(
    {
      input_tokens: 1000,
      output_tokens: 2000,
      input_tokens_details: {
        text_tokens: 200,
        image_tokens: 800,
        cached_tokens: 500,
      },
    },
    "image",
  );
  expect(
    referenceCost(usage, referencePrice("gpt-image-2.5-sunburst", "image")),
  ).toBeCloseTo(0.0674);
  expect(
    referenceCost(
      { ...usage, imageInputTokens: null },
      referencePrice("gpt-image-2", "image"),
    ),
  ).toBeNull();
});
it("does not invent missing, negative, fractional or inconsistent usage", () => {
  const price = referencePrice("gpt-4.1", "planning");
  expect(
    referenceCost(parseModelUsage(undefined, "planning"), price),
  ).toBeNull();
  expect(
    referenceCost(
      parseModelUsage({ prompt_tokens: 1, completion_tokens: 2 }, "planning"),
      price,
    ),
  ).toBeNull();
  expect(
    parseModelUsage(
      {
        prompt_tokens: -1,
        completion_tokens: 1.5,
        prompt_tokens_details: { cached_tokens: 99 },
      },
      "planning",
    ).inputTokens,
  ).toBeNull();
  expect(
    parseModelUsage(
      {
        prompt_tokens: 1,
        completion_tokens: 2,
        prompt_tokens_details: { cached_tokens: 99 },
      },
      "planning",
    ).cachedInputTokens,
  ).toBeNull();
  expect(
    referenceCost(
      parseModelUsage(
        {
          prompt_tokens: 0,
          completion_tokens: 0,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        "planning",
      ),
      price,
    ),
  ).toBe(0);
});
it("rejects prototype model identities and non-finite costs", () => {
  for (const name of ["constructor", "__proto__", "toString"])
    expect(referencePrice(name, "planning")).toBeNull();
  const usage = parseModelUsage(
    {
      prompt_tokens: 1,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 0 },
    },
    "planning",
  );
  expect(
    referenceCost(usage, {
      ...referencePrice("gpt-4.1", "planning")!,
      input: NaN,
    }),
  ).toBeNull();
});
it("uses fixed rates above 272K when a model has no long-context tier", () => {
  const usage = parseModelUsage(
    {
      prompt_tokens: 300000,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 0 },
    },
    "planning",
  );
  expect(
    referenceCost(usage, referencePrice("gpt-4.1", "planning")),
  ).toBeCloseTo(0.60008);
});

it("prices explicit 2.6 identities with a new immutable reference version", () => {
  for (const model of ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"]) {
    expect(referencePrice(model, "image")).toMatchObject({
      version: "openai-standard-2026-11-05",
      input: 5,
      imageInput: 8,
      output: 30,
    });
  }
  expect(referencePrice("gpt-image-2.6-flare-custom", "image")).toBeNull();
  expect(referencePrice("gpt-image-2.5-flare", "image")?.version).toBe(
    "openai-standard-2026-11-02",
  );
});
