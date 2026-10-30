import { imageDeclarationWithinKnownLimits } from "./image-model-knowledge.js";
import { z } from "zod";
import { imageCapability } from "./extensions.js";
export const modelKind = z.enum(["conversation", "image"]);
export type ModelKind = z.infer<typeof modelKind>;
export const modelId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\s\u0000-\u001f]+$/);
export const modelServiceInput = z
  .object({
    id: z.uuid().optional(),
    revision: z.number().int().nonnegative().default(0),
    name: z.string().trim().min(1).max(80),
    mode: z.enum(["openai", "fake"]),
    baseUrl: z.string().max(500),
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n]+$/)
      .optional(),
    preserveKey: z.boolean().default(false),
  })
  .strict();
export type ModelServiceInput = z.infer<typeof modelServiceInput>;
export interface ModelServiceView {
  id: string;
  revision: number;
  name: string;
  mode: "openai" | "fake";
  baseUrl: string;
  enabled: boolean;
  revoked: boolean;
  configured: boolean;
  catalogUpdatedAt: string | null;
}
export interface CatalogModel {
  serviceId: string;
  modelId: string;
  present: boolean;
  manual: boolean;
}
export const poolEntryInput = z
  .object({
    id: z.uuid(),
    serviceId: z.uuid(),
    modelId,
    kind: modelKind,
    enabled: z.boolean(),
    isDefault: z.boolean(),
    image: imageCapability.optional(),
    conversation: z
      .object({
        supportsImages: z.boolean(),
        responseMode: z.enum(["json_object", "text"]),
        maxOutputTokens: z.number().int().min(256).max(8192),
        maxInputCharacters: z.number().int().min(1000).max(64000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.kind === "image"
        ? !v.image || !!v.conversation || v.image.model !== v.modelId
        : !v.conversation || !!v.image
    )
      c.addIssue({
        code: "custom",
        message: "Model capability must match pool kind",
      });
    if (v.isDefault && !v.enabled)
      c.addIssue({ code: "custom", message: "Default must be enabled" });
  });
export type PoolEntryInput = z.infer<typeof poolEntryInput>;
export const poolPublication = z
  .object({
    revision: z.number().int().nonnegative(),
    entries: z.array(poolEntryInput).max(60),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.entries.map((e) => e.id)).size !== v.entries.length ||
      new Set(v.entries.map((e) => [e.serviceId, e.modelId, e.kind].join("/")))
        .size !== v.entries.length
    )
      c.addIssue({ code: "custom", message: "Duplicate model" });
    for (const entry of v.entries) {
      if (entry.image && !imageDeclarationWithinKnownLimits(entry.image))
        c.addIssue({
          code: "custom",
          message: "Declared image limits exceed documented model capability",
        });
    }
    for (const kind of ["image", "conversation"]) {
      const enabled = v.entries.filter((e) => e.kind === kind && e.enabled);
      const defaults = enabled.filter((e) => e.isDefault);
      if (defaults.length !== (enabled.length ? 1 : 0))
        c.addIssue({
          code: "custom",
          message: "Each nonempty pool needs exactly one default",
        });
    }
  });
export type PoolPublication = z.infer<typeof poolPublication>;
export interface ModelCatalogSnapshot {
  managed: boolean;
  testingAllowed?: boolean;
  revision: number;
  services: ModelServiceView[];
  models: CatalogModel[];
  entries: PoolEntryInput[];
}
export interface ModelChoice {
  id: string;
  serviceId: string;
  serviceName: string;
  modelId: string;
  kind: ModelKind;
  isDefault: boolean;
  supportsImages: boolean;
  image?: z.infer<typeof imageCapability>;
}
export interface UserModelPools {
  image: ModelChoice[];
  conversation: ModelChoice[];
}
