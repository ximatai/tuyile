import { z } from "zod";
import { imageInput } from "./creation.js";
import { toolBinding } from "./extensions.js";

// A plan contains declarative image operations. Only server confirmation admits work.
export const agentStep = imageInput
  .omit({ projectId: true, requestKey: true })
  .extend({
    title: z.string().trim().min(1).max(100),
    tool: toolBinding,
    usePrevious: z.boolean().default(false),
  })
  .strict();
export const agentPlan = z
  .object({
    message: z.string().trim().min(1).max(4000),
    steps: z.array(agentStep).max(16),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.steps.reduce((sum, step) => sum + step.count, 0) > 16)
      ctx.addIssue({
        code: "custom",
        message: "A plan may reserve at most 16 images",
      });
    plan.steps.forEach((step, index) => {
      if (index === 0 && step.usePrevious)
        ctx.addIssue({
          code: "custom",
          message: "The first step has no previous output",
        });
      if (
        new Set(step.referenceIds).size !== step.referenceIds.length ||
        step.referenceIds.length + Number(step.usePrevious) > 4
      )
        ctx.addIssue({ code: "custom", message: "Invalid reference set" });
    });
  });
export type AgentStep = z.infer<typeof agentStep>;
export type AgentPlan = z.infer<typeof agentPlan>;
export const planningRequest = imageInput
  .omit({ count: true })
  .extend({
    skillId: z.uuid().optional(),
    conversationModelId: z.uuid().optional(),
    previousPlanId: z.uuid().optional(),
  })
  .strict();
export type PlanningRequest = z.infer<typeof planningRequest>;
export const planRevisionInput = z
  .object({
    requestKey: z.uuid(),
    document: agentPlan,
  })
  .strict();
export type PlanRevisionInput = z.infer<typeof planRevisionInput>;
export interface AgentPlanVersion {
  id: string;
  jobId: string;
  version: number;
  document: AgentPlan;
  confirmed: boolean;
  taskIds: string[];
}
export interface PlanningJob {
  id: string;
  projectId: string;
  requestKey: string;
  prompt: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  charged: boolean;
  errorCode: string | null;
  createdAt: string;
  plans: AgentPlanVersion[];
}
export const planningPolicyInput = z
  .object({
    allowedModels: z.array(z.uuid()).max(60).optional(),
    queueLimit: z.number().int().min(1).max(100).default(10),
    dailyLimit: z.number().int().min(0).max(10000),
    concurrency: z.number().int().min(1).max(8),
  })
  .strict();
export type PlanningPolicy = z.infer<typeof planningPolicyInput>;
export interface PlanningUsage extends PlanningPolicy {
  used: number;
  held: number;
  available: number;
}
