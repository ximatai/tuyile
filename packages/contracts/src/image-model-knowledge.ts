import type { ImageCapability } from "./extensions.js";

// Documented model limits, separate from each administrator's allowed subset.
const gptImage25 = {
  source:
    "https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options",
  checkedAt: "2026-11-05",
  evidence: "documentation" as const,
  markup: true,
  formats: ["png", "jpeg", "webp"] as const,
  qualities: ["low", "medium", "high"] as const, // Application-supported subset.
  maxEdge: 3840,
  minPixels: 655360,
  maxPixels: 8294400,
  maxAspectRatio: 3,
};
const gptImage26 = {
  ...gptImage25,
  formats: ["png", "jpeg", "webp", "svg"] as const,
  checkedAt: "2026-11-05",
  complexities: ["low", "medium", "high"] as const,
};
const knownModels = new Set([
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare-2026-09-08",
]);
export function imageModelKnowledge(model: string) {
  if (["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"].includes(model))
    return gptImage26;
  return knownModels.has(model)
    ? { ...gptImage25, complexities: [] as const }
    : undefined;
}
export function imageSizeWithinKnownLimits(
  model: string,
  width: number,
  height: number,
) {
  const known = imageModelKnowledge(model);
  return (
    !known ||
    (width % 16 === 0 &&
      height % 16 === 0 &&
      width > 0 &&
      height > 0 &&
      Math.max(width, height) <= known.maxEdge &&
      width * height >= known.minPixels &&
      width * height <= known.maxPixels &&
      Math.max(width / height, height / width) <= known.maxAspectRatio)
  );
}
export function effectiveImageCapability(
  declared: ImageCapability,
): ImageCapability {
  const known = imageModelKnowledge(declared.model);
  if (!known) return declared;
  return {
    ...declared,
    ...(declared.complexities
      ? {
          complexities: declared.complexities.filter((v) =>
            (known.complexities as readonly string[]).includes(v),
          ),
        }
      : {}),
    maxEdge: Math.min(declared.maxEdge, known.maxEdge),
    maxPixels: Math.min(declared.maxPixels, known.maxPixels),
    formats: declared.formats.filter((format) =>
      (known.formats as readonly string[]).includes(format),
    ),
    qualities: declared.qualities.filter((quality) =>
      known.qualities.includes(quality),
    ),
  };
}

export function imageDeclarationWithinKnownLimits(declared: ImageCapability) {
  const known = imageModelKnowledge(declared.model);
  return (
    !known ||
    ((!declared.formats.includes("svg") ||
      (known.formats as readonly string[]).includes("svg")) &&
      (declared.complexities ?? []).every((v) =>
        (known.complexities as readonly string[]).includes(v),
      ) &&
      declared.maxEdge <= known.maxEdge &&
      declared.maxPixels <= known.maxPixels &&
      declared.sizes.every((size) => {
        const [w, h] = size.split("x").map(Number);
        return imageSizeWithinKnownLimits(declared.model, w!, h!);
      }))
  );
}
