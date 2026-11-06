import { z } from "zod";
import { imageInput, type CreationStyle } from "./creation.js";
import { toolBinding } from "./extensions.js";

// A plan contains declarative image operations. Only server confirmation admits work.
export const agentStep = imageInput
  .omit({
    projectId: true,
    requestKey: true,
    style: true,
    annotation: true,
    editSession: true,
    preserveRequirements: true,
    textNodeIds: true,
    textCanvasRevision: true,
  })
  .extend({
    id: z.string().min(1).max(100).optional(),
    dependsOn: z.string().min(1).max(100).optional(),
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
    const ids = plan.steps.flatMap((s) => (s.id ? [s.id] : []));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate step identity" });
    plan.steps.forEach((step, index) => {
      if (
        step.dependsOn &&
        (!plan.steps.slice(0, index).some((s) => s.id === step.dependsOn) ||
          step.usePrevious)
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid explicit dependency",
        });
      if (index === 0 && step.usePrevious)
        ctx.addIssue({
          code: "custom",
          message: "The first step has no previous output",
        });
      if (
        new Set(step.referenceIds).size !== step.referenceIds.length ||
        step.referenceIds.length +
          Number(step.usePrevious || !!step.dependsOn) >
          4
      )
        ctx.addIssue({ code: "custom", message: "Invalid reference set" });
    });
  });
export type AgentStep = z.infer<typeof agentStep>;
export type AgentPlan = z.infer<typeof agentPlan>;
export const agentDerivation = z
  .object({ id: z.uuid(), assetId: z.uuid() })
  .strict();
export type AgentDerivation = z.infer<typeof agentDerivation>;
export const planningRequest = imageInput
  .omit({ count: true, annotation: true, editSession: true })
  .extend({
    skillId: z.uuid().optional(),
    conversationModelId: z.uuid().optional(),
    previousPlanId: z.uuid().optional(),
    derivation: agentDerivation.optional(),
    preserveRequirements: z.string().trim().max(2000).optional(),
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
  derivation?: AgentDerivation;
  preserveRequirements?: string;
  textSources?: import("./creation.js").TextSource[];
  id: string;
  projectId: string;
  requestKey: string;
  prompt: string;
  style?: CreationStyle;
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

// Legacy plans acquire deterministic identities on read; stored hashes are untouched.
export function identifyPlan(
  document: AgentPlan,
  namespace: string,
): AgentPlan {
  const ids = document.steps.map((s, i) => s.id ?? `${namespace}:${i}`);
  return agentPlan.parse({
    ...document,
    steps: document.steps.map((s, i) => ({
      ...s,
      id: ids[i],
      ...(s.usePrevious ? { dependsOn: ids[i - 1], usePrevious: false } : {}),
    })),
  });
}
export const planSelectionInput = z
  .object({
    requestKey: z.uuid(),
    stepIds: z.array(z.string().min(1).max(100)).min(1).max(16),
    bindings: z
      .array(
        z
          .object({ stepId: z.string().min(1).max(100), assetId: z.uuid() })
          .strict(),
      )
      .max(16)
      .default([]),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.stepIds).size !== v.stepIds.length ||
      new Set(v.bindings.map((b) => b.stepId)).size !== v.bindings.length
    )
      c.addIssue({ code: "custom", message: "Duplicate selection" });
  });
export type PlanSelectionInput = z.infer<typeof planSelectionInput>;
export function selectPlan(
  document: AgentPlan,
  selection: PlanSelectionInput,
): AgentPlan {
  const selected = new Set(selection.stepIds);
  const bindings = new Map(
    selection.bindings.map((b) => [b.stepId, b.assetId]),
  );
  if (selection.stepIds.some((id) => !document.steps.some((s) => s.id === id)))
    throw new Error("UNKNOWN_STEP");
  const used = new Set<string>();
  const steps = document.steps
    .filter((s) => selected.has(s.id!))
    .map((s) => {
      if (!s.dependsOn || selected.has(s.dependsOn)) return { ...s };
      const asset = bindings.get(s.dependsOn);
      if (!asset) throw new Error("MISSING_DEPENDENCY");
      used.add(s.dependsOn);
      return {
        ...s,
        dependsOn: undefined,
        usePrevious: false,
        referenceIds: [...new Set([...s.referenceIds, asset])],
      };
    });
  if (selection.bindings.some((b) => !used.has(b.stepId)))
    throw new Error("UNUSED_BINDING");
  return agentPlan.parse({ ...document, steps });
}
