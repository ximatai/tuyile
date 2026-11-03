import { type ComponentRef, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import type { ReviewTask } from "@tuyile/contracts";
import { Button, Image, Input, Tooltip } from "@tuyile/ui";
import { HelpPopover } from "./interface-help";
import { taskStates } from "./task-presentation";

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
});
const relativeTime = new Intl.RelativeTimeFormat("zh-CN");
const attemptStates: Record<string, string> = {
  dispatched: "已发出",
  received: "已收到响应",
  succeeded: "成功",
  rejected: "失败",
  unknown: "结果未知",
  resolved: "已核验",
};

function reviewAge(value: string, now: number) {
  const minutes = Math.floor(Math.max(0, now - Date.parse(value)) / 60_000);
  if (minutes >= 1440)
    return relativeTime.format(-Math.floor(minutes / 1440), "day");
  if (minutes >= 60)
    return relativeTime.format(-Math.floor(minutes / 60), "hour");
  return minutes ? relativeTime.format(-minutes, "minute") : "不到 1 分钟前";
}

function ReviewTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateTime.format(new Date(value))}</time>;
}

function ReviewImage({ userId, assetId }: { userId: string; assetId: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const trigger = useRef<ComponentRef<typeof Button>>(null);
  return (
    <>
      <Tooltip title="预览已保存图片">
        <Button
          type="button"
          ref={trigger}
          className="help-trigger"
          aria-label="预览已保存图片"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ImageIcon size={16} aria-hidden="true" />
        </Button>
      </Tooltip>
      {open && (
        <div className="review-attempt-image">
          {failed ? (
            <>
              <span role="status">图片加载失败</span>{" "}
              <Button
                type="button"
                onClick={() => {
                  trigger.current?.focus();
                  setFailed(false);
                }}
              >
                重试
              </Button>
            </>
          ) : (
            <Image
              alt="已保存图片"
              preview={false}
              src={`/api/admin/users/${userId}/artworks/${assetId}/preview`}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      )}
    </>
  );
}

export function ReviewTaskCard({
  task: t,
  now,
  busy,
  visible,
  onResolve,
}: {
  task: ReviewTask;
  now: number;
  busy: boolean;
  visible: boolean;
  onResolve: (taskId: string, reason: string) => void;
}) {
  return (
    <article aria-label="核验任务" className="review-task">
      <div className="review-task-summary">
        <strong title={t.userId}>{t.username}</strong>
        <div>
          {taskStates[t.state]} · {t.used}/{t.count} 张
        </div>
        <div className="review-task-meta">
          <span>{t.model}</span>
          <span aria-hidden="true">·</span>
          <span className="review-task-age">
            {!t.finishedAt && "提交于 "}
            {reviewAge(t.finishedAt ?? t.createdAt, now)}
          </span>
        </div>
      </div>
      <div className="review-task-controls">
        <HelpPopover title="核验详情" actionLabel="核验" visible={visible}>
          <div className="review-task-meta">
            <span>
              任务 <code>{t.id}</code>
            </span>
            <span>
              提交 <ReviewTime value={t.createdAt} />
            </span>
            {t.finishedAt && (
              <span>
                结束 <ReviewTime value={t.finishedAt} />
              </span>
            )}
          </div>
          {t.attempts.length > 0 && (
            <ul className="review-attempts" aria-label="模型调用">
              {t.attempts.map((a) => (
                <li key={a.id}>
                  <span>
                    第 {a.ordinal + 1} 张{a.retry > 0 ? "（重试）" : ""}
                  </span>
                  <strong
                    className={
                      a.state === "unknown"
                        ? "review-attempt-unknown"
                        : undefined
                    }
                  >
                    {attemptStates[a.state] ?? a.state}
                  </strong>
                  {a.state === "succeeded" && a.previewAssetId && (
                    <ReviewImage userId={t.userId} assetId={a.previewAssetId} />
                  )}
                  <span>
                    发出 <ReviewTime value={a.createdAt} />
                  </span>
                  {a.httpStatus != null && <span>HTTP {a.httpStatus}</span>}
                  {a.errorCode && <code>{a.errorCode}</code>}
                  <span>
                    调用 <code>{a.id}</code>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            确认剩余结果无法取得后再释放。
            {t.used > 0 && "已保存的图片会保留。"}
            释放预留不返还上游尝试。
          </p>
          <form
            className="review-task-action"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(
                new FormData(e.currentTarget).get("reason") ?? "",
              ).trim();
              onResolve(t.id, reason);
            }}
          >
            <Input
              aria-label="核验原因（选填）"
              name="reason"
              placeholder="核验原因（选填）"
              maxLength={500}
            />
            <Button disabled={busy}>释放剩余预留</Button>
          </form>
        </HelpPopover>
        <span className="review-task-hold">预留 {t.held} 张</span>
      </div>
    </article>
  );
}
