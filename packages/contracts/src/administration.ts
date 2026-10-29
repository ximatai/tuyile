import { z } from "zod";
const lane = z
  .object({
    concurrency: z.number().int().min(1).max(16),
    queueLimit: z.number().int().min(1).max(1000),
  })
  .strict();
export const executionSettingsInput = z
  .object({ images: lane, planning: lane })
  .strict();
export type ExecutionSettings = z.infer<typeof executionSettingsInput>;
export interface AdminSummary {
  imageStates: Record<string, number>;
  planningStates: Record<string, number>;
  today: {
    imagesUsed: number;
    imagesHeld: number;
    planningUsed: number;
    planningHeld: number;
    imageAttempts: number;
    planningCalls: number;
    unknownPlanningUsage: number;
  };
  storage: { used: number; reserved: number };
  pendingReview: number;
  reconciliation: {
    imageDays: number;
    imageReservations: number;
    planningDays: number;
  };
  errors: {
    id: string;
    userId: string;
    kind: "image" | "planning";
    code: string;
    createdAt: string;
  }[];
  audits: {
    id: string;
    actorId: string;
    targetId: string | null;
    action: string;
    createdAt: string;
  }[];
}
