import { AppError } from "./index.js";
import type { ImagePolicy, ImageTask } from "@tuyile/contracts";

export function checkAdmissionBudget(input: {
  count: number;
  policy: ImagePolicy;
  queued: number;
  ownQueued: number;
  queueLimit: number;
  recentSubmissions: number;
  used: number;
  held: number;
  storageUsed: number;
  storageReserved: number;
  requiredStorage: number;
}) {
  if (
    input.queued >= input.queueLimit ||
    input.ownQueued >= input.policy.queueLimit
  )
    throw new AppError("QUEUE_FULL", 429);
  if (input.recentSubmissions >= 6) throw new AppError("SUBMISSION_RATE", 429);
  if (input.used + input.held + input.count > input.policy.imageLimit)
    throw new AppError("IMAGE_QUOTA", 409);
  if (
    input.storageUsed + input.storageReserved + input.requiredStorage >
    input.policy.storageLimit
  )
    throw new AppError("STORAGE_QUOTA", 409);
}

export function completedTaskState(input: {
  count: number;
  used: number;
  unknownHeld: number;
  cancelled: boolean;
}): ImageTask["state"] {
  if (input.used === input.count) return "succeeded";
  if (input.used > 0) return "partial";
  return input.cancelled && input.unknownHeld === 0 ? "cancelled" : "failed";
}
