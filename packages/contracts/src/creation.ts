import { imageCapability, type ImageCapability } from "./extensions.js";
import { z } from "zod";
export const creationStyle = z
  .object({
    name: z.string().trim().min(1).max(80),
    text: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .regex(/^[^\u0000]+$/),
  })
  .strict();
export type CreationStyle = z.infer<typeof creationStyle>;
export interface TextSource {
  nodeId: string;
  title: string;
  text: string;
}
export const textNodeIds = z
  .array(z.uuid())
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length);
export function composeCreativePrompt(input: {
  textSources?: TextSource[];
  prompt: string;
  style?: CreationStyle;
}) {
  return [
    input.prompt.trim(),
    ...(input.textSources?.map(
      (s, i) => `引用文案 ${i + 1}（${s.title || "未命名文案"}）：\n${s.text}`,
    ) ?? []),
    ...(input.style ? [`画面风格：${input.style.text}`] : []),
  ].join("\n\n");
}
export const imageInput = z.object({
  projectId: z.uuid(),
  requestKey: z.uuid(),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .regex(/^[^\u0000]+$/),
  style: creationStyle.optional(),
  model: z.string().min(1).max(120),
  modelSelectionId: z.uuid().optional(),
  width: z.number().int().min(256).max(8192).multipleOf(16),
  height: z.number().int().min(256).max(8192).multipleOf(16),
  quality: z.enum(["low", "medium", "high"]),
  format: z.enum(["png", "jpeg", "webp"]),
  count: z.number().int().min(1).max(16),
  referenceIds: z.array(z.uuid()).max(4).default([]),
  textNodeIds: textNodeIds.optional(),
  textCanvasRevision: z.number().int().min(0).max(2147483647).optional(),
});
export type ImageInput = z.infer<typeof imageInput>;
export const policyInput = z.object({
  imageLimit: z.number().int().min(-1).max(10000),
  attemptsLimit: z.number().int().min(0).max(10000),
  storageLimit: z.number().int().min(0).max(1099511627776),
  concurrency: z.number().int().min(1).max(8),
  queueLimit: z.number().int().min(1).max(100),
  maxEdge: z.number().int().min(256).max(8192),
  maxPixels: z.number().int().min(65536).max(32000000),
  maxCount: z.number().int().min(1).max(16),
  maxQuality: z.enum(["low", "medium", "high"]),
  allowedModels: z.array(z.string().min(1).max(120)).max(30),
});
export type ImagePolicy = z.infer<typeof policyInput>;
export const providerInput = z.object({
  mode: z.enum(["openai", "fake"]),
  baseUrl: z.string().max(500),
  models: z.array(z.string().min(1).max(120)).min(1).max(30),
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/)
    .optional(),
  preserveKey: z.boolean().default(false),
  capabilities: z.array(imageCapability).min(1).max(30).optional(),
});
export type ProviderInput = z.infer<typeof providerInput>;
export interface ImageAsset {
  id: string;
  outputId: string;
  deleted: boolean;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}
export interface ImageTask {
  id: string;
  projectId: string;
  requestKey: string;
  state:
    "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
  prompt: string;
  finalPrompt?: string;
  textSources?: TextSource[];
  model: string;
  count: number;
  settings?: Pick<
    ImageInput,
    | "style"
    | "width"
    | "height"
    | "quality"
    | "format"
    | "modelSelectionId"
    | "referenceIds"
  >;
  used: number;
  held: number;
  pendingReview: boolean;
  cancelRequested: boolean;
  errorCode: string | null;
  createdAt: string;
  outputs: ImageAsset[];
}
export interface ImageUsage {
  day: string;
  used: number;
  held: number;
  available: number | null;
  attempts: number;
  earlierHeld: number;
  storageUsed: number;
  storageReserved: number;
  policy: ImagePolicy;
  models: string[];
  providerMode: string | null;
  modelOptions?: import("./model-catalog.js").ModelChoice[];
  capabilities: ImageCapability[];
}
export interface ProviderView {
  id: string;
  mode: string;
  baseUrl: string;
  models: string[];
  active: boolean;
  revoked: boolean;
  configured: boolean;
  capabilities: ImageCapability[];
}
export interface ReviewTask {
  id: string;
  userId: string;
  state: string;
  pendingReview: boolean;
  used: number;
  held: number;
  createdAt: string;
  attempts: {
    id: string;
    state: string;
    httpStatus: number | null;
    errorCode: string | null;
  }[];
}
