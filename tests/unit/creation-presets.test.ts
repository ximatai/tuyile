import { expect, it } from "vitest";
import type { ImageUsage, ImageCapability } from "@tuyile/contracts";
import { defaultImagePolicy } from "@tuyile/core";
import {
  applyStyle,
  styleParagraph,
  standardSizes,
} from "../../apps/web/src/creation-presets";
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
it("keeps the prompt visible, replaces only the previously selected intact style and removes it reversibly", () => {
  const first = applyStyle("产品说明", "none", "photo");
  expect(first).toBe(`产品说明\n\n${styleParagraph("photo")}`);
  const changed = applyStyle(first, "photo", "poster");
  expect(changed).not.toContain(styleParagraph("photo"));
  expect(applyStyle(changed, "poster", "none")).toBe("产品说明");
});
it("preserves manual style edits and does not double append a reused style paragraph", () => {
  const manual = "主体\n\n画面风格：我修改过的光线。";
  expect(applyStyle(manual, "photo", "poster")).toContain(manual);
  const reused = applyStyle("主体", "none", "photo");
  expect(applyStyle(reused, "none", "photo")).toBe(reused);
  expect(applyStyle("主体", "none", "unknown")).toBe("主体");
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
