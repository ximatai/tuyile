import {
  imageCapabilityDefaults,
  effectiveImageCapability,
  imageSizeWithinKnownLimits,
} from "@tuyile/contracts";
import type { ImageCapability, ImageInput } from "@tuyile/contracts";
import { AppError } from "./index.js";
/** Compatibility profile is an administrator declaration, not provider discovery. */
export { imageCapabilityDefaults as defaultImageCapability } from "@tuyile/contracts";
export function normalizeCapabilities(
  models: string[],
  capabilities?: ImageCapability[],
) {
  const values = capabilities ?? models.map(imageCapabilityDefaults);
  if (
    new Set(values.map((c) => c.model)).size !== values.length ||
    values.length !== new Set(models).size ||
    values.some((c) => !models.includes(c.model))
  )
    throw new AppError("INVALID_MODEL_CAPABILITIES", 400);
  if (values.some((c) => c.formats.includes("svg") && !c.svgAuthor))
    throw new AppError("INVALID_MODEL_CAPABILITIES", 400);
  return values;
}
export function checkImageCapability(
  input: ImageInput,
  capabilities: ImageCapability[],
) {
  const declared = capabilities.find((c) => c.model === input.model);
  const c = declared && effectiveImageCapability(declared);
  if (
    !c ||
    (input.format === "svg" &&
      (!c.svgAuthor ||
        input.count !== 1 ||
        input.referenceIds.length !== 0 ||
        input.editSession ||
        input.annotation)) ||
    !imageSizeWithinKnownLimits(input.model, input.width, input.height) ||
    (input.referenceIds.length ? !c.editing : !c.generation) ||
    input.referenceIds.length > c.maxReferences ||
    input.width > c.maxEdge ||
    input.height > c.maxEdge ||
    input.width * input.height > c.maxPixels ||
    !c.qualities.includes(input.quality) ||
    !c.formats.includes(input.format) ||
    (input.editSession &&
      (input.referenceIds.length !== 1 || input.count !== 1)) ||
    (input.annotation !== undefined &&
      (!c.markup ||
        input.referenceIds.length !== 1 ||
        input.count !== 1 ||
        !input.annotation.strokes.length)) ||
    (input.complexity !== undefined &&
      !c.complexities?.includes(input.complexity)) ||
    (c.sizes.length && !c.sizes.includes(`${input.width}x${input.height}`))
  )
    throw new AppError("MODEL_CAPABILITY_UNSUPPORTED", 409);
}
