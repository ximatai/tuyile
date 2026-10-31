import { expect, it } from "vitest";
import type { ImageTask } from "@tuyile/contracts";
import {
  canReuseTask,
  taskProblem,
} from "../../apps/web/src/task-presentation";
const task = (patch: Partial<ImageTask> = {}) =>
  ({
    state: "failed",
    used: 0,
    count: 2,
    settings: {},
    pendingReview: false,
    errorCode: null,
    ...patch,
  }) as ImageTask;
it("allows restoring a failed draft with zero outputs, without allowing active or unknown work", () => {
  expect(canReuseTask(task())).toBe(true);
  for (const state of ["queued", "running"] as const)
    expect(canReuseTask(task({ state }))).toBe(false);
  expect(canReuseTask(task({ pendingReview: true }))).toBe(false);
  expect(canReuseTask(task({ settings: undefined }))).toBe(false);
});
it("unknown outcomes override ordinary failures and never recommend resubmission", () => {
  const message = taskProblem(
    task({ pendingReview: true, errorCode: "UPSTREAM_FAILURE", used: 1 }),
  )!;
  expect(message).toContain("额度仍预留");
  expect(message).toContain("不要重复生成");
  expect(message).not.toContain("重新提交");
});
it("explains a known failure, keeps saved output usable and hides raw error codes", () => {
  expect(
    taskProblem(task({ errorCode: "UPSTREAM_RATE_LIMIT", used: 1 })),
  ).toContain("模型服务繁忙");
  expect(
    taskProblem(task({ errorCode: "UPSTREAM_RATE_LIMIT", used: 1 })),
  ).toContain("已保存 1 张");
  expect(
    taskProblem(task({ errorCode: "UNRECOGNIZED_INTERNAL_CODE" })),
  ).not.toContain("UNRECOGNIZED_INTERNAL_CODE");
  expect(taskProblem(task({ errorCode: "WORKER_INTERRUPTED" }))).toContain(
    "后台执行中断",
  );
  expect(taskProblem(task({ state: "cancelled" }))).toContain("可能计费");
  for (const state of ["queued", "running", "succeeded"] as const)
    expect(taskProblem(task({ state }))).toBeNull();
});
