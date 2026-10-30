import { standardSizes, type SizePreset } from "./creation-presets";
import type {
  ImageInput,
  ImageUsage,
  ImageCapability,
  ImageTask,
} from "@tuyile/contracts";

export type ImageSettings = Pick<
  ImageInput,
  "width" | "height" | "quality" | "format" | "count"
> & { modelKey: string };
const qualityOrder = ["low", "medium", "high"] as const;
export function selectedCapability(
  usage: ImageUsage,
  key: string,
): ImageCapability | undefined {
  return usage.modelOptions
    ? usage.modelOptions.find((m) => m.id === key)?.image
    : usage.capabilities.find((c) => c.model === key);
}
export function modelChoices(usage?: ImageUsage) {
  return (
    usage?.modelOptions?.map((m) => ({
      value: m.id,
      label: `${m.modelId} · ${m.serviceName}`,
    })) ?? (usage?.models ?? []).map((m) => ({ value: m, label: m }))
  );
}
export function allowedQualities(usage: ImageUsage, cap?: ImageCapability) {
  return qualityOrder.filter(
    (q) =>
      cap?.qualities.includes(q) &&
      qualityOrder.indexOf(q) <= qualityOrder.indexOf(usage.policy.maxQuality),
  );
}
export function validSize(
  usage: ImageUsage,
  cap: ImageCapability,
  width: number,
  height: number,
) {
  return (
    [width, height].every(
      (n) =>
        Number.isInteger(n) &&
        n >= 256 &&
        n % 16 === 0 &&
        n <= Math.min(cap.maxEdge, usage.policy.maxEdge),
    ) && width * height <= Math.min(cap.maxPixels, usage.policy.maxPixels)
  );
}
export function sizeChoices(usage: ImageUsage, cap?: ImageCapability) {
  if (!cap) return [];
  const sizes = cap.sizes.length
    ? cap.sizes.map((s) => s.split("x").map(Number) as [number, number])
    : [
        [1, 1],
        [3, 4],
        [4, 3],
        [9, 16],
        [16, 9],
      ].map(([w, h]) => {
        const scale =
          Math.floor(
            Math.min(
              1024 / Math.max(w!, h!),
              cap.maxEdge / Math.max(w!, h!),
              usage.policy.maxEdge / Math.max(w!, h!),
              Math.sqrt(
                Math.min(cap.maxPixels, usage.policy.maxPixels) / (w! * h!),
              ),
            ) / 16,
          ) * 16;
        return [w! * scale, h! * scale] as [number, number];
      });
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return sizes
    .filter(([w, h]) => validSize(usage, cap, w, h))
    .map(([w, h]) => {
      const divisor = gcd(w, h),
        ratio = `${w / divisor}:${h / divisor}`;
      const scene = w === h ? "方形" : w > h ? "横版" : "竖版";
      return { value: `${w}x${h}`, label: `${scene} ${ratio} · ${w} × ${h}` };
    });
}
export function initialSettings(usage: ImageUsage): ImageSettings {
  const modelKey = usage.modelOptions
    ? (usage.modelOptions.find((m) => m.isDefault)?.id ??
      usage.modelOptions[0]?.id ??
      "")
    : (usage.models[0] ?? "");
  const cap = selectedCapability(usage, modelKey),
    sizes = sizeChoices(usage, cap),
    qualities = allowedQualities(usage, cap);
  const [width, height] = (
    sizes.find((s) => s.value === "1024x1024")?.value ??
    sizes[0]?.value ??
    "1024x1024"
  )
    .split("x")
    .map(Number);
  return {
    modelKey,
    width: width!,
    height: height!,
    quality: qualities.includes("medium")
      ? "medium"
      : (qualities[0] ?? "medium"),
    format: cap?.formats.includes("png") ? "png" : (cap?.formats[0] ?? "png"),
    count: 1,
  };
}
export function settingsIssues(
  usage: ImageUsage,
  settings: ImageSettings,
  referenceCount: number,
): string[] {
  const cap = selectedCapability(usage, settings.modelKey);
  if (!cap) return ["原模型已不可用，请重新选择图片模型及服务。"];
  const errors: string[] = [];
  if (
    !validSize(usage, cap, settings.width, settings.height) ||
    (cap.sizes.length > 0 &&
      !cap.sizes.includes(`${settings.width}x${settings.height}`))
  )
    errors.push("当前尺寸不受支持，请选择画面规格。");
  if (!allowedQualities(usage, cap).includes(settings.quality))
    errors.push("当前质量不受支持，请重新选择。");
  if (!cap.formats.includes(settings.format))
    errors.push("当前格式不受支持，请重新选择。");
  if (
    !Number.isInteger(settings.count) ||
    settings.count < 1 ||
    settings.count > usage.policy.maxCount
  )
    errors.push(`图片张数应为 1–${usage.policy.maxCount}。`);
  if (
    referenceCount
      ? !cap.editing || referenceCount > cap.maxReferences
      : !cap.generation
  )
    errors.push(
      referenceCount
        ? `当前模型最多支持 ${cap.editing ? cap.maxReferences : 0} 张参考图，请移除参考图或选择其他模型。`
        : "当前模型仅支持带参考图编辑，请添加参考图。",
    );
  return errors;
}
// Pool IDs are service-specific. Legacy raw model names must never select a same-named service implicitly.
export function taskSettings(
  task: ImageTask,
  usage: ImageUsage,
): ImageSettings | null {
  if (!task.settings) return null;
  return {
    ...task.settings,
    count: task.count,
    modelKey: usage.modelOptions
      ? (task.settings.modelSelectionId ?? `historical:${task.id}`)
      : task.settings.modelSelectionId
        ? `historical:${task.id}`
        : task.model,
  };
}

export function supportedSizePresets(
  usage: ImageUsage,
  cap?: ImageCapability,
): SizePreset[] {
  if (!cap) return [];
  const allowed = (p: SizePreset) => validSize(usage, cap, p.width, p.height);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  if (cap.sizes.length)
    return cap.sizes.flatMap((size) => {
      const [width, height] = size.split("x").map(Number) as [number, number];
      const known = standardSizes.find(
        (p) => p.width === width && p.height === height,
      );
      const divisor = gcd(width, height);
      const preset = known ?? {
        tier: `${Math.max(width, height)}px`,
        ratio: `${width / divisor}:${height / divisor}`,
        width,
        height,
      };
      return allowed(preset) ? [preset] : [];
    });
  const presets = standardSizes.filter(allowed);
  // Retain usable small presets for stricter policies rather than assuming 1K is always allowed.
  if (!presets.length)
    return sizeChoices(usage, cap).map((s) => {
      const [width, height] = s.value.split("x").map(Number) as [
          number,
          number,
        ],
        divisor = gcd(width, height);
      return {
        tier: `${Math.max(width, height)}px`,
        ratio: `${width / divisor}:${height / divisor}`,
        width,
        height,
      };
    });
  return presets;
}
