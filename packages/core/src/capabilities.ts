import { imageCapabilityDefaults } from "@tuyile/contracts";
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
  return values;
}
export function checkImageCapability(
  input: ImageInput,
  capabilities: ImageCapability[],
) {
  const c = capabilities.find((c) => c.model === input.model);
  if (
    !c ||
    (input.referenceIds.length ? !c.editing : !c.generation) ||
    input.referenceIds.length > c.maxReferences ||
    input.width > c.maxEdge ||
    input.height > c.maxEdge ||
    input.width * input.height > c.maxPixels ||
    !c.qualities.includes(input.quality) ||
    !c.formats.includes(input.format) ||
    (c.sizes.length && !c.sizes.includes(`${input.width}x${input.height}`))
  )
    throw new AppError("MODEL_CAPABILITY_UNSUPPORTED", 409);
}
