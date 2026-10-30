import { composeCreativePrompt } from "@tuyile/contracts";
import { expect, it } from "vitest";
import type { ImageUsage, ImageCapability } from "@tuyile/contracts";
import { defaultImagePolicy } from "@tuyile/core";
import { standardSizes } from "../../apps/web/src/creation-presets";
import {
  sizeOptionLabel,
  supportedSizePresets,
} from "../../apps/web/src/image-settings";
const capability: ImageCapability = {
  model: "test",
  generation: true,
  editing: true,
  maxReferences: 4,
  maxEdge: 8192,
  maxPixels: 32000000,
  sizes: [],
  qualities: ["medium"],
  formats: ["png"],
};
const usage = { policy: defaultImagePolicy } as ImageUsage;
it("composes separate style without parsing or changing authored text", () => {
  const prompt = "主体\n\n画面风格：用户自行写的内容";
  expect(composeCreativePrompt({ prompt })).toBe(prompt);
  expect(
    composeCreativePrompt({ prompt, style: { name: "摄影", text: "自然光" } }),
  ).toBe(`${prompt}\n\n画面风格：自然光`);
});
it("limits resolution tiers to declared dimensions and personal budgets", () => {
  expect(
    supportedSizePresets(usage, { ...capability, sizes: ["1024x1024"] }),
  ).toEqual([{ tier: "1K", ratio: "1:1", width: 1024, height: 1024 }]);
  const allowed = supportedSizePresets(usage, capability);
  expect(new Set(allowed.map((p) => p.tier))).toEqual(
    new Set(["1K", "2K", "720p"]),
  );
  expect(allowed.some((p) => p.ratio === "16:9")).toBe(true);
  expect(
    supportedSizePresets(
      {
        ...usage,
        policy: { ...defaultImagePolicy, maxEdge: 8192, maxPixels: 32000000 },
      },
      capability,
    ).some((p) => p.tier === "4K"),
  ).toBe(true);
});
it("retains arbitrary fixed model sizes without inventing ratio or pixel capability", () => {
  const presets = supportedSizePresets(usage, {
    ...capability,
    sizes: ["768x1024", "1000x1000"],
  });
  expect(presets).toEqual([
    { tier: "1024px", ratio: "3:4", width: 768, height: 1024 },
  ]);
});
it("provides smaller valid presets under restrictive policies and every standard dimension is contract compatible", () => {
  const smaller = supportedSizePresets(
    {
      ...usage,
      policy: { ...defaultImagePolicy, maxEdge: 800, maxPixels: 400000 },
    },
    capability,
  );
  expect(smaller.length).toBeGreaterThan(0);
  for (const p of smaller) {
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(800);
    expect(p.width * p.height).toBeLessThanOrEqual(400000);
  }
  for (const p of standardSizes) {
    expect(p.width % 16).toBe(0);
    expect(p.height % 16).toBe(0);
  }
});

it("names common sizes only when the pixels match exactly", () => {
  expect(sizeOptionLabel({ width: 1280, height: 720 })).toBe(
    "1280 × 720 · 720p",
  );
  expect(sizeOptionLabel({ width: 1920, height: 1088 })).toBe("1920 × 1088");
  expect(sizeOptionLabel({ width: 1024, height: 1024 })).toBe("1024 × 1024");
});
