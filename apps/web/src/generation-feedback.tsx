import type { ImageTask } from "@tuyile/contracts";
import { Button, Spin } from "@tuyile/ui";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { generationStatus, type GenerationPhase } from "./generation-status";
export function GenerationFeedback({
  tasks,
  phase = "idle",
  pending = false,
  stale = false,
  rejected = false,
  onShow,
  compact = false,
}: {
  tasks: ImageTask[];
  phase?: GenerationPhase;
  pending?: boolean;
  stale?: boolean;
  rejected?: boolean;
  onShow?: () => void;
  compact?: boolean;
}) {
  const status = generationStatus(tasks, phase, pending, stale, rejected);
  if (!status) return null;
  return (
    <div
      className={`generation-feedback ${status.tone}`}
      role={compact ? undefined : "status"}
      aria-label={compact ? "画布生成进度" : "图片生成状态"}
      aria-live={compact ? "off" : "polite"}
      aria-atomic="true"
    >
      <span className="generation-indicator" aria-hidden="true">
        {status.busy ? (
          <Spin size="small" />
        ) : status.tone === "success" ? (
          <CircleCheck size={17} />
        ) : (
          <TriangleAlert size={17} />
        )}
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
