import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ReviewTask } from "@tuyile/contracts";
import { useFeedback, Button, Field, Notice, Tabs } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { ModelServicesAdmin } from "./model-services-admin";
import { ExtensionsAdmin } from "./extensions-admin";
import { OperationsAdmin } from "./operations-admin";
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

export function ImageAdminPage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState(),
    api = client(csrfToken);
  const [section, setSection] = useState("models"),
    [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (section !== "operations") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [section]);
  const feedback = useFeedback();
  const notifySuccess = feedback.success;
  const review = useQuery({
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
      {review.error && <Notice error>{review.error.message}</Notice>}
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
            label: "运行与核验",
            forceRender: true,
            children: (
              <>
                <OperationsAdmin />
                <section className="settings-section">
                  <h2>结果待核验</h2>
                  <p className="hint">
                    确认无法取得图片后释放预留，不增加图片消费次数，也不返还上游尝试。
                  </p>
                  {review.data?.tasks.length === 0 && <p>暂无待核验任务。</p>}
                  {review.data?.tasks.map((t) => (
                    <form
                      key={t.id}
                      aria-label="核验任务"
                      className="review-task"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const reason = new FormData(e.currentTarget).get(
                          "reason",
                        );
                        void run(async () => {
                          await api(`/image-admin/review/${t.id}`, {
                            confirmed: 0,
                            reason,
                          });
                        });
                      }}
                    >
                      <div className="review-task-heading">
                        <div className="review-task-summary">
                          <strong title={t.userId}>{t.username}</strong>
                          <span>{taskStates[t.state]}</span>
                          <span>
                            已保存 {t.used} / {t.count} 张
                          </span>
                          <strong className="review-task-hold">
                            预留 {t.held} 张
                          </strong>
                        </div>
                        <span className="review-task-age">
                          {t.finishedAt ? "进入待核验" : "提交于"}{" "}
                          {reviewAge(t.finishedAt ?? t.createdAt, now)}
                        </span>
                      </div>
                      <div className="review-task-meta">
                        <span>模型 {t.model}</span>
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
                      <div className="review-task-action">
                        <Field
                          label="核验原因"
                          name="reason"
                          placeholder="记录核对依据或无法取得图片的原因"
                          minLength={3}
                          maxLength={500}
                          required
                        />
                        <Button disabled={busy}>
                          确认无法取得图片并释放预留
                        </Button>
                      </div>
                    </form>
                  ))}
                </section>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
