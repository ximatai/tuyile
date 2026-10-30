import { expect, it } from "vitest";
import type { ImageTask } from "@tuyile/contracts";
import { generationStatus } from "../../apps/web/src/generation-status";
const task = (patch: Partial<ImageTask> = {}) =>
  ({
    state: "queued",
    used: 0,
    count: 2,
    pendingReview: false,
    ...patch,
  }) as ImageTask;
it("does not report an older success as completion of a rejected new submission", () => {
  expect(
    generationStatus(
      [task({ state: "succeeded", used: 2 })],
      "idle",
      false,
      false,
      true,
    ),
  ).toMatchObject({ title: "本次图片任务未提交", tone: "error", busy: false });
  expect(
    generationStatus(
      [task({ state: "succeeded", used: 2 })],
      "idle",
      true,
      false,
      true,
    )?.title,
  ).toBe("提交结果待确认");
});
it("reports submission immediately and distinguishes unknown acceptance from generation", () => {
  expect(generationStatus([], "submit", true)).toMatchObject({
    busy: true,
    title: "正在提交图片任务…",
  });
  expect(generationStatus([], "recover", true)?.title).toContain("查找");
  expect(
    generationStatus([task({ state: "running" })], "idle", true),
  ).toMatchObject({ busy: false, tone: "warning", title: "提交结果待确认" });
});
it("aggregates only active saved images, queue counts and outstanding unknown outcomes", () => {
  const summary = generationStatus([
    task({ state: "running", used: 1 }),
    task(),
    task({ state: "succeeded", used: 9, count: 9 }),
    task({ state: "partial", used: 1, pendingReview: true }),
  ])!;
  expect(summary).toMatchObject({ busy: true, title: "正在生成图片…" });
  expect(summary.detail).toBe("已保存 1 / 4 张 · 1 项排队 · 1 项待核验");
  expect(generationStatus([task()])?.title).toContain("排队");
});
it("does not present stale cached running states as current verified progress", () => {
  expect(
    generationStatus([task({ state: "running" })], "idle", false, true),
  ).toMatchObject({
    busy: false,
    tone: "warning",
    title: "暂时无法更新生成状态",
  });
});
it("keeps completion, partial failure, cancellation and unknown results distinct", () => {
  expect(
    generationStatus([task({ state: "succeeded", used: 2 })]),
  ).toMatchObject({ busy: false, tone: "success", detail: "已保存 2 张图片" });
  expect(
    generationStatus([task({ state: "partial", used: 1 })])?.title,
  ).toContain("部分");
  expect(generationStatus([task({ state: "failed" })])?.tone).toBe("error");
  expect(generationStatus([task({ state: "cancelled" })])?.title).toContain(
    "已取消",
  );
  expect(
    generationStatus([task({ state: "failed", pendingReview: true })])?.title,
  ).toBe("生成结果待核验");
  expect(generationStatus([])).toBeNull();
});
