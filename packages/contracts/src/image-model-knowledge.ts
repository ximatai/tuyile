import type { ImageCapability } from "./extensions.js";

// Documented model limits, separate from each administrator's allowed subset.
const gptImage25 = {
  source:
    "https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options",
  checkedAt: "2026-10-30",
  evidence: "documentation" as const,
  formats: ["png", "jpeg", "webp"] as const,
  qualities: ["low", "medium", "high"] as const, // Application-supported subset.
  maxEdge: 3840,
  minPixels: 655360,
  maxPixels: 8294400,
  maxAspectRatio: 3,
};
const knownModels = new Set([
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare-2026-09-08",
]);
export function imageModelKnowledge(model: string) {
  return knownModels.has(model) ? gptImage25 : undefined;
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
    maxEdge: Math.min(declared.maxEdge, known.maxEdge),
    maxPixels: Math.min(declared.maxPixels, known.maxPixels),
    formats: declared.formats.filter((format) =>
      known.formats.includes(format),
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
    (declared.maxEdge <= known.maxEdge &&
      declared.maxPixels <= known.maxPixels &&
      declared.sizes.every((size) => {
        const [w, h] = size.split("x").map(Number);
        return imageSizeWithinKnownLimits(declared.model, w!, h!);
      }))
  );
}
