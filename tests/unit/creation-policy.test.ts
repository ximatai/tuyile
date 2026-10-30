import { expect, it } from "vitest";
import {
  checkAdmissionBudget,
  completedTaskState,
  defaultImagePolicy,
} from "@tuyile/core";
it("counts all holds even after a policy reduction, and admits exactly the remaining budget", () => {
  const budget = {
    count: 2,
    policy: { ...defaultImagePolicy, imageLimit: 5 },
    queued: 0,
    ownQueued: 0,
    queueLimit: 64,
    recentSubmissions: 0,
    used: 1,
    held: 2,
    storageUsed: 0,
    storageReserved: 0,
    requiredStorage: 42,
  };
  expect(() => checkAdmissionBudget(budget)).not.toThrow();
  expect(() => checkAdmissionBudget({ ...budget, count: 3 })).toThrow(
    "IMAGE_QUOTA",
  );
  expect(() =>
    checkAdmissionBudget({
      ...budget,
      policy: { ...budget.policy, imageLimit: 2 },
    }),
  ).toThrow("IMAGE_QUOTA");
  expect(() =>
    checkAdmissionBudget({
      ...budget,
      storageUsed: defaultImagePolicy.storageLimit,
    }),
  ).toThrow("STORAGE_QUOTA");
});
it("retains partial success and unknown calls when cancellation races a result", () => {
  expect(
    completedTaskState({ count: 2, used: 1, unknownHeld: 1, cancelled: true }),
  ).toBe("partial");
  expect(
    completedTaskState({ count: 2, used: 0, unknownHeld: 1, cancelled: true }),
  ).toBe("failed");
  expect(
    completedTaskState({ count: 2, used: 0, unknownHeld: 0, cancelled: true }),
  ).toBe("cancelled");
  expect(
    completedTaskState({ count: 2, used: 2, unknownHeld: 0, cancelled: true }),
  ).toBe("succeeded");
});

it("unlimited image quotas still enforce storage, queue and submission limits", () => {
  const budget = {
    count: 4,
    policy: { ...defaultImagePolicy, imageLimit: -1 },
    queued: 0,
    ownQueued: 0,
    queueLimit: 64,
    recentSubmissions: 0,
    used: 100000,
    held: 100000,
    storageUsed: 0,
    storageReserved: 0,
    requiredStorage: 42,
  };
  expect(() => checkAdmissionBudget(budget)).not.toThrow();
  expect(() =>
    checkAdmissionBudget({
      ...budget,
      policy: { ...budget.policy, imageLimit: 0 },
    }),
  ).toThrow("IMAGE_QUOTA");
  expect(() =>
    checkAdmissionBudget({
      ...budget,
      storageUsed: defaultImagePolicy.storageLimit,
    }),
  ).toThrow("STORAGE_QUOTA");
  expect(() => checkAdmissionBudget({ ...budget, queued: 64 })).toThrow(
    "QUEUE_FULL",
  );
  expect(() =>
    checkAdmissionBudget({ ...budget, recentSubmissions: 6 }),
  ).toThrow("SUBMISSION_RATE");
});
