import { z } from "zod";
export const toolBinding = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/),
    version: z.number().int().min(1).max(1000000),
  })
  .strict();
export type ToolBinding = z.infer<typeof toolBinding>;
export const imageCapability = z
  .object({
    model: z.string().min(1).max(120),
    generation: z.boolean(),
    editing: z.boolean(),
    maxReferences: z.number().int().min(0).max(4),
    maxEdge: z.number().int().min(256).max(8192),
    maxPixels: z.number().int().min(65536).max(32000000),
    sizes: z.array(z.string().regex(/^\d{3,4}x\d{3,4}$/)).max(30),
    qualities: z
      .array(z.enum(["low", "medium", "high"]))
      .min(1)
      .max(3),
    formats: z
      .array(z.enum(["png", "jpeg", "webp"]))
      .min(1)
      .max(3),
  })
  .strict();
export type ImageCapability = z.infer<typeof imageCapability>;
export const planningProviderInput = z
  .object({
    mode: z.enum(["openai", "fake"]),
    baseUrl: z.string().max(500),
    model: z.string().min(1).max(120),
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n]+$/)
      .optional(),
    preserveKey: z.boolean().default(false),
    responseMode: z.enum(["json_object", "text"]).default("json_object"),
    maxOutputTokens: z.number().int().min(256).max(8192).default(4096),
    maxInputCharacters: z.number().int().min(1000).max(64000).default(32000),
  })
  .strict();
export type PlanningProviderInput = z.infer<typeof planningProviderInput>;
export interface PlanningProviderView extends Omit<
  PlanningProviderInput,
  "apiKey" | "preserveKey"
> {
  id: string;
  active: boolean;
  revoked: boolean;
}
export const skillInput = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/),
    version: z.number().int().min(1).max(1000000),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    instructions: z.string().trim().min(1).max(12000),
    scenarios: z.array(z.string().min(1).max(120)).max(10),
    requiredInputs: z
      .array(z.enum(["prompt", "referenceImages"]))
      .min(1)
      .max(2),
    tools: z.array(toolBinding).min(1).max(16),
    enabled: z.boolean().default(true),
  })
  .strict();
export type SkillInput = z.infer<typeof skillInput>;
export interface SkillView extends SkillInput {
  id: string;
  revoked: boolean;
}
export interface ToolView extends ToolBinding {
  name: string;
  inputSchema: "image-input-v1";
  outputSchema: "image-bytes-v1";
  permission: "image:create";
  externalAccess: "configured-image-provider";
  effect: "one-image";
  minReferences: number;
  maxReferences: number;
  enabled: boolean;
  revoked: boolean;
}
export const extensionState = z
  .object({ enabled: z.boolean(), revoked: z.boolean() })
  .strict();

export function imageCapabilityDefaults(model: string): ImageCapability {
  return {
    model,
    generation: true,
    editing: true,
    maxReferences: 4,
    maxEdge: 8192,
    maxPixels: 32000000,
    sizes: [],
    qualities: ["low", "medium", "high"],
    formats: ["png", "jpeg", "webp"],
  };
}
