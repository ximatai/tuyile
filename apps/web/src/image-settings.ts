import {
  effectiveImageCapability,
  imageSizeWithinKnownLimits,
  imageModelKnowledge,
} from "@tuyile/contracts";
import { standardSizes, type SizePreset } from "./creation-presets";
import type {
  ImageInput,
  ImageUsage,
  ImageCapability,
  ImageTask,
} from "@tuyile/contracts";

export type ImageSettings = Pick<
  ImageInput,
  "width" | "height" | "quality" | "complexity" | "format" | "count"
> & { modelKey: string };
const qualityOrder = ["low", "medium", "high"] as const;
export function selectedCapability(
  usage: ImageUsage,
  key: string,
): ImageCapability | undefined {
  const declared = usage.modelOptions
    ? usage.modelOptions.find((m) => m.id === key)?.image
    : usage.capabilities.find((c) => c.model === key);
  return declared && effectiveImageCapability(declared);
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
    imageSizeWithinKnownLimits(cap.model, width, height) &&
    [width, height].every(
      (n) =>
        Number.isInteger(n) &&
        n >= 256 &&
        n % 16 === 0 &&
        n <= Math.min(cap.maxEdge, usage.policy.maxEdge),
    ) &&
    width * height <= Math.min(cap.maxPixels, usage.policy.maxPixels)
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
export function imageSizeIssue(
  usage: ImageUsage,
  cap: ImageCapability,
  { width, height }: Pick<ImageSettings, "width" | "height">,
) {
  if (cap.sizes.length)
    return validSize(usage, cap, width, height) &&
      cap.sizes.includes(`${width}x${height}`)
      ? undefined
      : "当前模型仅支持指定尺寸，请选择画面规格。";
  const fields = imageSizeFieldIssues(usage, cap, { width, height });
  if (fields.width || fields.height) return fields.width ?? fields.height;
  const maxPixels = Math.min(cap.maxPixels, usage.policy.maxPixels);
  if (width * height > maxPixels)
    return `总像素不能超过 ${maxPixels.toLocaleString()}。`;
  const known = imageModelKnowledge(cap.model);
  if (known && width * height < known.minPixels)
    return `总像素至少为 ${known.minPixels.toLocaleString()}。`;
  if (known && Math.max(width / height, height / width) > known.maxAspectRatio)
    return `长边不能超过短边的 ${known.maxAspectRatio} 倍。`;
}

export function settingsIssues(
  usage: ImageUsage,
  settings: ImageSettings,
  referenceCount: number,
): string[] {
  const cap = selectedCapability(usage, settings.modelKey);
  if (!cap) return ["原模型已不可用，请重新选择图片模型及服务。"];
  const errors: string[] = [];
  const sizeIssue = imageSizeIssue(usage, cap, settings);
  if (sizeIssue) errors.push(sizeIssue);
  if (!allowedQualities(usage, cap).includes(settings.quality))
    errors.push("当前质量不受支持，请重新选择。");
  if (
    settings.complexity !== undefined &&
    !cap.complexities?.includes(settings.complexity)
  )
    errors.push("当前复杂度不受支持，请重新选择或使用模型默认。");
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
    width: task.settings.width,
    height: task.settings.height,
    ...(task.settings.complexity !== undefined
      ? { complexity: task.settings.complexity }
      : {}),
    quality: task.settings.quality,
    format: task.settings.format,
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

export function sizeOptionLabel(size: Pick<SizePreset, "width" | "height">) {
  const pixels = `${size.width} × ${size.height}`;
  const common = new Map([
    ["1280x720", "720p"],
    ["1920x1080", "1080p"],
    ["2560x1440", "1440p"],
    ["3840x2160", "4K"],
  ]).get(`${size.width}x${size.height}`);
  return common ? `${pixels} · ${common}` : pixels;
}

export function imageSizeFieldIssues(
  usage: ImageUsage,
  cap: ImageCapability,
  size: Pick<ImageSettings, "width" | "height">,
) {
  const maxEdge = Math.min(
    effectiveImageCapability(cap).maxEdge,
    usage.policy.maxEdge,
  );
  const issue = (label: string, n: number) => {
    if (!Number.isFinite(n) || n === 0) return `请填写${label}。`;
    if (n < 256) return `${label}至少为 256 像素。`;
    if (n > maxEdge) return `${label}不能超过 ${maxEdge} 像素。`;
    if (!Number.isInteger(n)) return `${label}须为整数。`;
    if (n % 16 !== 0) return `${label}须为 16 的倍数。`;
  };
  return {
    width: issue("宽度", size.width),
    height: issue("高度", size.height),
  };
}
// Only offer explainable single-axis edits. Search the product's bounded 16px
// grid, checking the complete model/policy constraints rather than presets.
export function imageSizeCorrections(
  usage: ImageUsage,
  declared: ImageCapability,
  size: Pick<ImageSettings, "width" | "height">,
): Pick<ImageSettings, "width" | "height">[] {
  const cap = effectiveImageCapability(declared);
  if (
    cap.sizes.length ||
    ![size.width, size.height].every((n) => Number.isFinite(n) && n > 0) ||
    !imageSizeIssue(usage, cap, size)
  )
    return [];
  const maxEdge = Math.min(8192, cap.maxEdge, usage.policy.maxEdge);
  const candidates: Pick<ImageSettings, "width" | "height">[] = [];
  for (const axis of ["width", "height"] as const) {
    let below: Pick<ImageSettings, "width" | "height"> | undefined;
    let above: Pick<ImageSettings, "width" | "height"> | undefined;
    for (let edge = 256; edge <= maxEdge; edge += 16) {
      const next = { ...size, [axis]: edge };
      if (
        edge === size[axis] ||
        !validSize(usage, cap, next.width, next.height)
      )
        continue;
      if (edge < size[axis]) below = next;
      else {
        above = next;
        break;
      }
    }
    if (below) candidates.push(below);
    if (above) candidates.push(above);
  }
  const distance = (next: Pick<ImageSettings, "width" | "height">) =>
    Math.abs(next.width - size.width) + Math.abs(next.height - size.height);
  const nearest = Math.min(...candidates.map(distance));
  return candidates.filter((next) => distance(next) === nearest).slice(0, 2);
}

export function sizeCorrectionLabel(
  before: Pick<ImageSettings, "width" | "height">,
  after: Pick<ImageSettings, "width" | "height">,
) {
  const axes = (["width", "height"] as const).filter(
    (axis) => before[axis] !== after[axis],
  );
  if (axes.length !== 1) return `改为 ${after.width} × ${after.height}`;
  const axis = axes[0]!,
    delta = after[axis] - before[axis];
  return `${axis === "width" ? "宽" : "高"}改为 ${after[axis]}（${delta > 0 ? "+" : ""}${delta}）`;
}
export function modelSwitchSize(
  usage: ImageUsage,
  modelKey: string,
  value: ImageSettings,
) {
  const cap = selectedCapability(usage, modelKey);
  if (!cap?.sizes.length || !imageSizeIssue(usage, cap, value)) return {};
  const sizes = sizeChoices(usage, cap);
  const next = sizes.find((s) => s.value === "1024x1024") ?? sizes[0];
  if (!next) return {};
  const [width, height] = next.value.split("x").map(Number) as [number, number];
  return { width, height };
}

// Submission uses settingsIssues; ImageControls owns the size error presentation.
export function settingsDisplayIssues(
  usage: ImageUsage | undefined,
  settings: ImageSettings,
  issues: string[],
) {
  const cap = usage && selectedCapability(usage, settings.modelKey);
  const sizeIssue = usage && cap && imageSizeIssue(usage, cap, settings);
  return issues.filter((issue) => issue !== sizeIssue);
}
