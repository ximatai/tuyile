import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ReviewTask } from "@tuyile/contracts";
import { useFeedback, Notice, Tabs, Tag } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { ModelServicesAdmin } from "./model-services-admin";
import { ExtensionsAdmin } from "./extensions-admin";
import { OperationsAdmin, useAdminSummary } from "./operations-admin";
import { ReviewTaskCard } from "./review-task-card";

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
  const summary = useAdminSummary();
  const pendingCount = summary.data?.pendingReview ?? 0;
  const review = useQuery({
    refetchInterval: section === "review" ? 5000 : false,
    queryKey: state.key("image-review"),
    queryFn: ({ signal }) =>
      api<{ tasks: ReviewTask[] }>("/image-admin/review", undefined, signal),
  });
  async function resolveReview(taskId: string, reason: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/image-admin/review/${taskId}`, {
        confirmed: 0,
        ...(reason && { reason }),
      });
      await Promise.all([
        state.queries.invalidateQueries({ queryKey: state.key("usage") }),
        state.queries.invalidateQueries({
          queryKey: state.key("admin-summary"),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("image-review"),
        }),
      ]);
      feedback.success("已保存");
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
                    <ReviewTaskCard
                      key={t.id}
                      task={t}
                      now={now}
                      busy={busy}
                      visible={section === "review"}
                      onResolve={resolveReview}
                    />
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
