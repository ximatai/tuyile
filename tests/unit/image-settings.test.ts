import { expect, it } from "vitest";
import type { ImageCapability, ImageTask, ImageUsage } from "@tuyile/contracts";
import { defaultImagePolicy } from "@tuyile/core";
import {
  imageSizeCorrections,
  imageSizeIssue,
  validSize,
  settingsDisplayIssues,
  initialSettings,
  modelSwitchSize,
  imageSizeFieldIssues,
  sizeCorrectionLabel,
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

it("switches incompatible fixed sizes to legal defaults and preserves range drafts", () => {
  const draft = initialSettings(usage);
  expect(modelSwitchSize(usage, "pool-b", draft)).toEqual({
    width: 768,
    height: 1024,
  });
  expect(modelSwitchSize(usage, "pool-a", draft)).toEqual({});
  const range = {
    ...usage,
    modelOptions: [
      { ...usage.modelOptions![1]!, image: { ...cap, sizes: [] } },
    ],
  };
  expect(modelSwitchSize(range, "pool-b", { ...draft, width: 1000 })).toEqual(
    {},
  );
});
it("separates each field issue and describes correction deltas", () => {
  expect(imageSizeFieldIssues(usage, cap, { width: 0, height: 1000 })).toEqual({
    width: "请填写宽度。",
    height: "高度须为 16 的倍数。",
  });
  expect(
    sizeCorrectionLabel(
      { width: 1000, height: 1024 },
      { width: 1008, height: 1024 },
    ),
  ).toBe("宽改为 1008（+8）");
  expect(
    sizeCorrectionLabel(
      { width: 1000, height: 1000 },
      { width: 1024, height: 1024 },
    ),
  ).toBe("改为 1024 × 1024");
});

it("keeps submission strict while displaying size errors only beside controls", () => {
  const draft = { ...initialSettings(usage), width: 1000 };
  const issues = settingsIssues(usage, draft, 0);
  expect(issues.length).toBeGreaterThan(0);
  expect(settingsDisplayIssues(usage, draft, issues)).toEqual([]);
  expect(
    settingsDisplayIssues(usage, draft, [...issues, "其他阻止原因"]),
  ).toEqual(["其他阻止原因"]);
});
it("preserves compatible fixed dimensions", () => {
  expect(
    modelSwitchSize(usage, "pool-b", {
      ...initialSettings(usage),
      width: 768,
      height: 1024,
    }),
  ).toEqual({});
});

it("reports only the violated edge bound, with integer before step errors", () => {
  for (const [width, error] of [
    [255, "宽度至少为 256 像素。"],
    [2049, "宽度不能超过 2048 像素。"],
    [1000.5, "宽度须为整数。"],
    [1000, "宽度须为 16 的倍数。"],
    [256, undefined],
  ] as const) {
    expect(
      imageSizeFieldIssues(usage, cap, { width, height: 1024 }).width,
    ).toBe(error);
  }
});

it("offers nearest fully legal single-axis edits without preset fallback", () => {
  const range = { ...cap, sizes: [] };
  const known = { ...range, model: "gpt-image-2.5-sunburst" };
  const limited = { ...usage, policy: { ...usage.policy, maxPixels: 1048576 } };
  const cases = [
    [
      usage,
      range,
      { width: 255, height: 1024 },
      [{ width: 256, height: 1024 }],
    ],
    [usage, range, { width: 256, height: 1024 }, []],
    [
      usage,
      range,
      { width: 2049, height: 1024 },
      [{ width: 2048, height: 1024 }],
    ],
    [
      usage,
      range,
      { width: 1000, height: 1024 },
      [
        { width: 992, height: 1024 },
        { width: 1008, height: 1024 },
      ],
    ],
    [
      usage,
      known,
      { width: 255, height: 1024 },
      [{ width: 640, height: 1024 }],
    ],
    [
      usage,
      known,
      { width: 2048, height: 320 },
      [{ width: 2048, height: 688 }],
    ],
    [
      limited,
      known,
      { width: 1024, height: 1536 },
      [{ width: 672, height: 1536 }],
    ],
    [usage, known, { width: 256, height: 256 }, []],
    [usage, range, { width: 255, height: 255 }, []],
    [usage, range, { width: 0, height: 1024 }, []],
    [usage, range, { width: NaN, height: 1024 }, []],
    [usage, range, { width: 1024, height: Infinity }, []],
    [usage, cap, { width: 1000, height: 1024 }, []],
  ] as const;
  for (const [policy, model, before, expected] of cases) {
    const suggestions = imageSizeCorrections(policy, model, before);
    expect(suggestions).toEqual(expected);
    for (const after of suggestions) {
      expect(validSize(policy, model, after.width, after.height)).toBe(true);
      expect(imageSizeIssue(policy, model, after)).toBeUndefined();
      expect(
        Number(before.width !== after.width) +
          Number(before.height !== after.height),
      ).toBe(1);
    }
  }
});

it("uses known model edge ceilings even when declarations and policy are broader", () => {
  const broad = {
    ...usage,
    policy: { ...usage.policy, maxEdge: 8192, maxPixels: 67108864 },
  };
  for (const model of [
    "gpt-image-2.5-sunburst",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst-2026-09-08",
    "gpt-image-2.5-flare-2026-09-08",
  ]) {
    const declared = {
      ...cap,
      model,
      sizes: [],
      maxEdge: 8192,
      maxPixels: 67108864,
    };
    const before = { width: 3841, height: 1536 };
    expect(imageSizeFieldIssues(broad, declared, before).width).toBe(
      "宽度不能超过 3840 像素。",
    );
    expect(imageSizeCorrections(broad, declared, before)).toEqual([
      { width: 3840, height: 1536 },
    ]);
    expect(
      imageSizeCorrections(broad, declared, { width: 255, height: 1024 }),
    ).toEqual([{ width: 640, height: 1024 }]);
  }
});

it("recommends exploration and refinement within policy without switching models or sizes", async () => {
  const { recommendedSettings } =
    await import("../../apps/web/src/image-settings");
  const current = { ...initialSettings(usage), count: 4 };
  const fast = recommendedSettings(usage, current, "explore");
  const fine = recommendedSettings(usage, current, "refine");
  expect(fast).toMatchObject({
    modelKey: current.modelKey,
    width: current.width,
    height: current.height,
    count: 1,
    quality: "medium",
  });
  expect(fine.quality).toBe("medium");
  expect(current.count).toBe(4);
  expect(fine.complexity).toBeUndefined();
});

it("orders complexity semantically even when the administrator declares levels in reverse order", async () => {
  const { recommendedSettings } =
    await import("../../apps/web/src/image-settings");
  const values = structuredClone(usage);
  values.modelOptions![0].image!.complexities = ["high", "low"];
  const current = initialSettings(values);
  expect(recommendedSettings(values, current, "explore").complexity).toBe(
    "low",
  );
  expect(recommendedSettings(values, current, "refine").complexity).toBe(
    "high",
  );
});
