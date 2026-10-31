import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ReviewTask } from "@tuyile/contracts";
import { useFeedback, Button, Field, Notice, Tabs } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { ModelServicesAdmin } from "./model-services-admin";
import { ExtensionsAdmin } from "./extensions-admin";
import { OperationsAdmin } from "./operations-admin";
export function ImageAdminPage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState(),
    api = client(csrfToken);
  const [section, setSection] = useState("models"),
    [busy, setBusy] = useState(false);
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
                  {!review.data?.tasks.length && <p>暂无待核验任务。</p>}
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
                      <p>任务 {t.id}</p>
                      <p className="hint">
                        账号标识 {t.userId} · 已使用 {t.used} · 预留 {t.held}
                      </p>
                      {t.attempts.map((a) => (
                        <p className="hint" key={a.id}>
                          调用 {a.id} · {a.state} · {a.httpStatus ?? "状态未知"}
                        </p>
                      ))}
                      <Field
                        label="核验原因"
                        name="reason"
                        minLength={3}
                        maxLength={500}
                        required
                      />
                      <Button disabled={busy}>
                        确认无法取得图片并释放预留
                      </Button>
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
