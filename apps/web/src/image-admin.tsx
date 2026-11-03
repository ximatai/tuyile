import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type ReviewTask } from "@tuyile/contracts";
import {
  useFeedback,
  Button,
  Image,
  Input,
  Notice,
  Tabs,
  Tag,
  Tooltip,
} from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { ModelServicesAdmin } from "./model-services-admin";
import { ExtensionsAdmin } from "./extensions-admin";
import { OperationsAdmin, useAdminSummary } from "./operations-admin";
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
  return (
    <>
      <Tooltip title="预览已保存图片">
        <Button
          type="button"
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
          <Image
            alt="已保存图片"
            preview={false}
            src={`/api/admin/users/${userId}/artworks/${assetId}/preview`}
          />
        </div>
      )}
    </>
  );
}

export function ImageAdminPage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState(),
    api = client(csrfToken);
  const [section, setSection] = useState("models"),
    [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (section !== "review") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [section]);
  const feedback = useFeedback();
  const notifySuccess = feedback.success;
  const summary = useAdminSummary();
  const pendingCount = summary.data?.pendingReview ?? 0;
  const review = useQuery({
    refetchInterval: section === "review" ? 5000 : false,
    queryKey: state.key("image-review"),
    queryFn: ({ signal }) =>
      api<{ tasks: ReviewTask[] }>("/image-admin/review", undefined, signal),
  });
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await Promise.all([
        state.queries.invalidateQueries({ queryKey: state.key("usage") }),
        state.queries.invalidateQueries({
          queryKey: state.key("admin-summary"),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("image-review"),
        }),
      ]);
      notifySuccess("已保存");
    } catch (e) {
      feedback.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="image-admin">
      <h1>模型服务</h1>
      <Tabs
        activeKey={section}
        onChange={setSection}
        items={[
          {
            key: "models",
            label: "模型服务",
            children: <ModelServicesAdmin />,
            forceRender: true,
          },
          {
            key: "extensions",
            label: "技能与工具",
            children: <ExtensionsAdmin csrfToken={csrfToken} hidePlanning />,
            forceRender: true,
          },
          {
            key: "operations",
            label: "运行",
            forceRender: true,
            children: <OperationsAdmin summary={summary} />,
          },
          {
            key: "review",
            label: (
              <span className="review-tab-label">
                核验
                {pendingCount > 0 && (
                  <Tag color="blue" aria-label={`${pendingCount} 条待核验`}>
                    {pendingCount}
                  </Tag>
                )}
              </span>
            ),
            children: (
              <section className="review-section" aria-label="结果待核验">
                {review.error && <Notice error>{review.error.message}</Notice>}
                {review.isPending && <p role="status">正在加载待核验任务…</p>}
                {review.data?.tasks.length === 0 && <p>暂无待核验任务。</p>}
                <div className="review-grid">
                  {review.data?.tasks.map((t) => (
                    <article
                      key={t.id}
                      aria-label="核验任务"
                      className="review-task"
                    >
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
                        <HelpPopover
                          title="核验详情"
                          triggerLabel="核验"
                          visible={section === "review"}
                          focusContent
                        >
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
                            <ul
                              className="review-attempts"
                              aria-label="模型调用"
                            >
                              {t.attempts.map((a) => (
                                <li key={a.id}>
                                  <span>
                                    第 {a.ordinal + 1} 张
                                    {a.retry > 0 ? "（重试）" : ""}
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
                                  {a.state === "succeeded" &&
                                    a.previewAssetId && (
                                      <ReviewImage
                                        userId={t.userId}
                                        assetId={a.previewAssetId}
                                      />
                                    )}
                                  <span>
                                    发出 <ReviewTime value={a.createdAt} />
                                  </span>
                                  {a.httpStatus != null && (
                                    <span>HTTP {a.httpStatus}</span>
                                  )}
                                  {a.errorCode && <code>{a.errorCode}</code>}
                                  <span>
                                    调用 <code>{a.id}</code>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="hint">释放预留不返还上游尝试。</p>
                          <form
                            className="review-task-action"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const reason = String(
                                new FormData(e.currentTarget).get("reason") ??
                                  "",
                              ).trim();
                              void run(async () => {
                                await api(`/image-admin/review/${t.id}`, {
                                  confirmed: 0,
                                  ...(reason && { reason }),
                                });
                              });
                            }}
                          >
                            <Input
                              aria-label="核验原因（选填）"
                              name="reason"
                              placeholder="核验原因（选填）"
                              maxLength={500}
                            />
                            <Button disabled={busy}>确认无图并释放</Button>
                          </form>
                        </HelpPopover>
                        <span className="review-task-hold">
                          预留 {t.held} 张
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ),
          },
        ]}
      />
    </section>
  );
}
