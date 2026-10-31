import { expect, it } from "vitest";
import type { ImageCapability, ImageTask, ImageUsage } from "@tuyile/contracts";
import { defaultImagePolicy } from "@tuyile/core";
import {
  initialSettings,
  selectedCapability,
  settingsIssues,
  sizeChoices,
  taskSettings,
} from "../../apps/web/src/image-settings";
const cap: ImageCapability = {
  model: "same-name",
  generation: true,
  editing: true,
  maxReferences: 2,
  maxEdge: 2048,
  maxPixels: 4194304,
  sizes: ["1024x1024", "1536x1024"],
  qualities: ["medium", "high"],
  formats: ["png", "webp"],
};
const usage: ImageUsage = {
  day: "2026-10-30",
  used: 0,
  held: 0,
  available: 100,
  attempts: 0,
  earlierHeld: 0,
  storageUsed: 0,
  storageReserved: 0,
  policy: {
    ...defaultImagePolicy,
    maxQuality: "medium",
    maxEdge: 2048,
    maxPixels: 4194304,
  },
  models: [cap.model],
  providerMode: "fake",
  capabilities: [cap],
  modelOptions: [
    {
      id: "pool-a",
      serviceId: "service-a",
      serviceName: "A",
      modelId: cap.model,
      kind: "image",
      isDefault: true,
      supportsImages: true,
      image: cap,
    },
    {
      id: "pool-b",
      serviceId: "service-b",
      serviceName: "B",
      modelId: cap.model,
      kind: "image",
      isDefault: false,
      supportsImages: true,
      image: {
        ...cap,
        sizes: ["768x1024"],
        qualities: ["low"],
        formats: ["jpeg"],
      },
    },
  ],
};
it("initializes from allowed model capabilities and personal policy", () => {
  expect(initialSettings(usage)).toMatchObject({
    modelKey: "pool-a",
    width: 1024,
    height: 1024,
    quality: "medium",
    format: "png",
    count: 1,
  });
  const second = {
    ...usage,
    modelOptions: [{ ...usage.modelOptions![1]!, isDefault: true }],
  };
  expect(initialSettings(second)).toMatchObject({
    modelKey: "pool-b",
    width: 768,
    height: 1024,
    quality: "low",
    format: "jpeg",
  });
});
it("offers only declared sizes within policy, never inventing a ratio for fixed-size models", () => {
  expect(sizeChoices(usage, cap).map((s) => s.value)).toEqual([
    "1024x1024",
    "1536x1024",
  ]);
  expect(
    sizeChoices(
      { ...usage, policy: { ...usage.policy, maxPixels: 1048576 } },
      cap,
    ).map((s) => s.value),
  ).toEqual(["1024x1024"]);
  expect(sizeChoices(usage, { ...cap, sizes: ["1000x1000"] })).toEqual([]);
});
it("generates exact ratio presets with 16px increments under both edge and pixel budgets", () => {
  const limited = {
    ...usage,
    policy: { ...usage.policy, maxEdge: 800, maxPixels: 400000 },
  };
  const choices = sizeChoices(limited, { ...cap, sizes: [] });
  expect(choices.length).toBeGreaterThan(1);
  for (const s of choices) {
    const [width, height] = s.value.split("x").map(Number) as [number, number];
    expect(width % 16).toBe(0);
    expect(height % 16).toBe(0);
    expect(Math.max(width, height)).toBeLessThanOrEqual(800);
    expect(width * height).toBeLessThanOrEqual(400000);
  }
});
it("switching between identically named services preserves and flags incompatible draft values", () => {
  const draft = { ...initialSettings(usage), modelKey: "pool-b" };
  expect(settingsIssues(usage, draft, 0)).toHaveLength(3);
  expect(draft).toMatchObject({
    width: 1024,
    height: 1024,
    quality: "medium",
    format: "png",
  });
  expect(selectedCapability(usage, "pool-b")?.formats).toEqual(["jpeg"]);
  expect(settingsIssues(usage, { ...draft, modelKey: "removed" }, 0)).toEqual([
    "原模型已不可用，请重新选择图片模型及服务。",
  ]);
});
it("validates generation/editing modes, reference count, count and personal quality limits", () => {
  const draft = initialSettings(usage);
  expect(settingsIssues(usage, draft, 0)).toEqual([]);
  expect(
    settingsIssues(usage, { ...draft, quality: "high", count: 17 }, 3),
  ).toHaveLength(3);
  const editOnly = {
    ...usage,
    modelOptions: [
      { ...usage.modelOptions![0]!, image: { ...cap, generation: false } },
    ],
  };
  expect(settingsIssues(editOnly, draft, 0)).toHaveLength(1);
  expect(settingsIssues(editOnly, draft, 1)).toEqual([]);
});
it("reuses immutable selected identity and settings; legacy names cannot select a current same-named service", () => {
  const task = {
    id: "old-task",
    model: cap.model,
    count: 2,
    settings: {
      width: 1024,
      height: 1024,
      quality: "medium",
      format: "png",
      referenceIds: ["ref"],
    },
  } as ImageTask;
  expect(taskSettings(task, usage)).toMatchObject({
    modelKey: "historical:old-task",
    count: 2,
  });
  expect(settingsIssues(usage, taskSettings(task, usage)!, 1)).toHaveLength(1);
  const withIdentity = {
    ...task,
    settings: { ...task.settings!, modelSelectionId: "pool-b" },
  };
  expect(taskSettings(withIdentity, usage)?.modelKey).toBe("pool-b");
  expect(
    taskSettings(task, { ...usage, modelOptions: undefined })?.modelKey,
  ).toBe(cap.model);
  expect(
    taskSettings(withIdentity, { ...usage, modelOptions: undefined })?.modelKey,
  ).toBe("historical:old-task");
});

it("restores only image settings fields, keeping style and references out of saved settings", () => {
  const task = {
    id: "task",
    model: "same-name",
    count: 2,
    settings: {
      width: 1024,
      height: 1024,
      quality: "medium",
      format: "png",
      referenceIds: ["reference"],
      style: { name: "style", text: "text" },
      modelSelectionId: "pool",
    },
  } as ImageTask;
  expect(Object.keys(taskSettings(task, usage)!).sort()).toEqual([
    "count",
    "format",
    "height",
    "modelKey",
    "quality",
    "width",
  ]);
});
