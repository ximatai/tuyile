import type { ImageTask } from "@tuyile/contracts";
export type GenerationPhase = "idle" | "submit" | "recover";
export interface GenerationStatus {
  title: string;
  detail: string;
  busy: boolean;
  tone: "active" | "success" | "warning" | "error";
}
export function generationStatus(
  tasks: ImageTask[],
  phase: GenerationPhase = "idle",
  pending = false,
  stale = false,
  rejected = false,
): GenerationStatus | null {
  if (phase !== "idle")
    return {
      title: phase === "submit" ? "正在提交图片任务…" : "正在查找这次提交…",
      detail: "请稍候",
      busy: true,
      tone: "active",
    };
  if (pending)
    return {
      title: "提交结果待确认",
      detail: "请查找这次提交，勿重复创建任务",
      busy: false,
      tone: "warning",
    };
  if (rejected)
    return {
      title: "本次图片任务未提交",
      detail: "请查看错误提示后重试",
      busy: false,
      tone: "error",
    };
  if (stale && tasks.length)
    return {
      title: "暂时无法更新生成状态",
      detail: "后台任务可能仍在执行，请稍后查看",
      busy: false,
      tone: "warning",
    };
  const running = tasks.filter((t) => t.state === "running"),
    queued = tasks.filter((t) => t.state === "queued"),
    active = [...running, ...queued];
  if (active.length) {
    const reviewCount = tasks.filter((t) => t.pendingReview).length;
    const saved = active.reduce((n, t) => n + t.used, 0),
      count = active.reduce((n, t) => n + t.count, 0);
    return {
      title: running.length ? "正在生成图片…" : "图片任务排队中…",
      detail: `已保存 ${saved} / ${count} 张${queued.length && running.length ? ` · ${queued.length} 项排队` : ""}${reviewCount ? ` · ${reviewCount} 项待核验` : ""}`,
      busy: true,
      tone: "active",
    };
  }
  const review = tasks.find((t) => t.pendingReview),
    latest = review ?? tasks[0];
  if (!latest) return null;
  if (review)
    return {
      title: "生成结果待核验",
      detail: `已保存 ${review.used} 张 · 请联系管理员核验`,
      busy: false,
      tone: "warning",
    };
  if (latest.state === "succeeded")
    return {
      title: "图片生成完成",
      detail: `已保存 ${latest.used} 张图片`,
      busy: false,
      tone: "success",
    };
  return {
    title:
      latest.state === "partial"
        ? "图片部分生成完成"
        : latest.state === "cancelled"
          ? "图片任务已取消"
          : "图片生成未完成",
    detail: `已保存 ${latest.used} / ${latest.count} 张 · 查看任务了解详情`,
    busy: false,
    tone: latest.state === "cancelled" ? "warning" : "error",
  };
}
