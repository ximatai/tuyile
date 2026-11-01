import { z } from "zod";
export const publishDemoInput = z
  .object({
    projectId: z.uuid(),
    requestKey: z.uuid(),
    starterPrompt: z.string().trim().min(1).max(12000).optional(),
    agentPrompt: z.string().trim().min(1).max(12000).optional(),
  })
  .strict();
export type PublishDemoInput = z.infer<typeof publishDemoInput>;
export interface DemoStatus {
  state: "none" | "pending" | "failed" | "ready" | "removed";
  projectId?: string;
  shouldOpen?: boolean;
}
export interface DemoTemplateInfo {
  id: string;
  name: string;
  createdAt: string;
}
export interface DemoImage {
  assetId: string;
  label: string;
  prompt: string;
  model: string;
  settings: {
    width: number;
    height: number;
    quality: "low" | "medium" | "high";
    format: "png" | "jpeg" | "webp";
  };
  sourceIds: string[];
}
export interface ProjectDemo {
  templateId: string;
  name: string;
  images: DemoImage[];
}
