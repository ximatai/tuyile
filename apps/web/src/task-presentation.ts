import { composeCreativePrompt } from "@tuyile/contracts";
import type { ImageTask } from "@tuyile/contracts";
export const taskStates = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "未完成",
  cancelled: "已取消",
};
export function canReuseTask(task: ImageTask) {
  return (
    !!task.settings &&
    !task.pendingReview &&
    !["queued", "running"].includes(task.state)
  );
}
export function taskProblem(task: ImageTask): string | null {
  if (task.pendingReview)
    return "结果待核验，相关额度仍预留。请联系管理员，不要重复生成。";
  if (["queued", "running", "succeeded"].includes(task.state)) return null;
  const saved = task.used
    ? `已保存 ${task.used} 张图片，仍可查看和使用。`
    : "本次没有保存图片。";
  if (task.state === "cancelled")
    return `任务已取消。${saved}已发出的模型调用可能计费。`;
  const reasons: Record<string, string> = {
    WORKER_INTERRUPTED: "后台执行中断。",
    UPSTREAM_RATE_LIMIT: "模型服务繁忙，请稍后再试。",
    UPSTREAM_FAILURE: "模型服务未能完成生成。",
    UNSUPPORTED_RESPONSE: "模型返回的图片无法读取，请联系管理员检查服务。",
    UPSTREAM_RESPONSE_LIMIT:
      "模型返回的图片超出接收限制，请联系管理员检查服务。",
    MODEL_CAPABILITY_UNSUPPORTED: "模型不支持这次图片参数，请调整设置。",
    REFERENCE_UNAVAILABLE: "参考图已不可用，请重新选择。",
    STORAGE_QUOTA: "存储空间不足，请清理图片后再试。",
    DISK_LOW: "服务器空间不足，请联系管理员。",
  };
  return `${reasons[task.errorCode ?? ""] ?? "这次生成未全部完成。"}${saved}${canReuseTask(task) ? "可复用设置，检查后重新提交。" : ""}`;
}

// Reuse the historical content without silently attaching the current canvas text.
export function taskDraftPrompt(task: ImageTask) {
  return composeCreativePrompt({
    prompt: task.prompt,
    textSources: task.textSources,
  });
}
