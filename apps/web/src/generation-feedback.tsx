import { useEffect, useRef } from "react";
import type { ImageTask } from "@tuyile/contracts";
import { Button, Spin, useNotification } from "@tuyile/ui";
import { TriangleAlert } from "lucide-react";
import { generationStatus, type GenerationPhase } from "./generation-status";
export function GenerationFeedback({
  tasks,
  phase = "idle",
  pending = false,
  stale = false,
  rejected = false,
  onShow,
  compact = false,
  ready = true,
}: {
  tasks: ImageTask[];
  phase?: GenerationPhase;
  pending?: boolean;
  stale?: boolean;
  rejected?: boolean;
  onShow?: () => void;
  compact?: boolean;
  ready?: boolean;
}) {
  const status = generationStatus(tasks, phase, pending, stale, rejected);
  const notification = useNotification();
  const initialized = useRef(false);
  const previous = useRef(new Map<string, string>());
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (compact || !ready) return;
    const initial = !initialized.current;
    initialized.current = true;
    for (const task of tasks) {
      const before = previous.current.get(task.id);
      if (
        task.state === "succeeded" &&
        !initial &&
        before !== "succeeded" &&
        !shown.current.has(task.id)
      ) {
        shown.current.add(task.id);
        notification.success({
          key: task.id,
          title: `已生成 ${task.used} 张`,
          duration: 5,
          placement: "topRight",
          actions: onShow ? (
            <Button
              type="button"
              onClick={() => {
                notification.destroy(task.id);
                onShow();
              }}
            >
              查看任务
            </Button>
          ) : undefined,
        });
      }
      previous.current.set(task.id, task.state);
    }
  }, [tasks, compact, ready, notification, onShow]);
  useEffect(
    () => () => {
      for (const key of shown.current) notification.destroy(key);
    },
    [notification],
  );
  if (!status || status.tone === "success") return null;
  return (
    <div
      className={`generation-feedback ${status.tone}`}
      role={compact ? undefined : "status"}
      aria-label={compact ? "画布生成进度" : "图片生成状态"}
      aria-live={compact ? "off" : "polite"}
      aria-atomic="true"
    >
      <span className="generation-indicator" aria-hidden="true">
        {status.busy ? <Spin size="small" /> : <TriangleAlert size={17} />}
      </span>
      <div className="generation-feedback-copy">
        <strong>{status.title}</strong>
        <span>{status.detail}</span>
      </div>
      {onShow && tasks.length > 0 && (
        <Button type="button" onClick={onShow}>
          查看任务
        </Button>
      )}
    </div>
  );
}
