import { useState, useEffect, type FormEvent } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  type UsersPage,
  type ImagePolicy,
  type ReviewTask,
  type ModelCatalogSnapshot,
} from "@tuyile/contracts";
import { Button, Field, ChoiceField, Notice, Tabs, Select } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { ModelServicesAdmin } from "./model-services-admin";
import { ExtensionsAdmin } from "./extensions-admin";
import { OperationsAdmin } from "./operations-admin";
const fields: Record<string, string> = {
  imageLimit: "每日图片额度",
  attemptsLimit: "每日上游尝试上限",
  storageLimit: "存储上限（字节）",
  concurrency: "每用户执行并发",
  queueLimit: "每用户排队上限",
  maxEdge: "最大边长",
  maxPixels: "最大像素数",
  maxCount: "单次最多张数",
};
export function ImageAdminPage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState(),
    api = client(csrfToken);
  const [section, setSection] = useState("models"),
    [user, setUser] = useState(""),
    [draft, setDraft] = useState<{ owner: string; policy: ImagePolicy } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const users = useInfiniteQuery({
    queryKey: state.key("admin-users"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<UsersPage>(`/admin/users?offset=${pageParam}`, undefined, signal),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const allUsers = users.data?.pages.flatMap((p) => p.users) ?? [],
    selected = user || allUsers[0]?.id || "";
  const policy = useQuery({
    queryKey: state.key("image-policy", selected),
    enabled: !!selected,
    queryFn: ({ signal }) =>
      api<ImagePolicy>(`/image-admin/policies/${selected}`, undefined, signal),
    refetchOnWindowFocus: false,
  });
  const catalog = useQuery({
    queryKey: state.key("model-catalog"),
    queryFn: ({ signal }) =>
      api<ModelCatalogSnapshot>("/model-admin/catalog", undefined, signal),
  });
  const review = useQuery({
    queryKey: state.key("image-review"),
    queryFn: ({ signal }) =>
      api<{ tasks: ReviewTask[] }>("/image-admin/review", undefined, signal),
  });
  const current = draft?.owner === selected ? draft.policy : policy.data;
  useEffect(() => {
    setDraft(null);
    setError("");
    setMessage("");
  }, [selected]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await Promise.all([
        state.queries.invalidateQueries({ queryKey: state.key("usage") }),
        state.queries.invalidateQueries({
          queryKey: state.key("image-policy", selected),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("image-review"),
        }),
      ]);
      setMessage("已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function patch(v: Partial<ImagePolicy>) {
    if (current) setDraft({ owner: selected, policy: { ...current, ...v } });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    await run(async () => {
      await api(`/image-admin/policies/${selected}`, current);
      setDraft(null);
    });
  }
  const choices =
    catalog.data?.entries
      .filter((e) => e.kind === "image")
      .map((e) => ({
        value: e.id,
        label: `${e.modelId} · ${catalog.data!.services.find((s) => s.id === e.serviceId)?.name ?? "服务不可用"}`,
      })) ?? [];
  return (
    <section className="image-admin">
      <h1>模型服务</h1>
      {(error || users.error || policy.error || review.error) && (
        <Notice error>
          {error ||
            users.error?.message ||
            policy.error?.message ||
            review.error?.message}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}
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
            key: "policies",
            label: "用户策略",
            forceRender: true,
            children: (
              <section className="settings-section">
                <h2>个人图片策略</h2>
                <ChoiceField
                  label="选择账号"
                  value={selected}
                  onValueChange={setUser}
                  options={allUsers.map((u) => ({
                    value: u.id,
                    label: u.username,
                  }))}
                />
                {users.hasNextPage && (
                  <Button onClick={() => void users.fetchNextPage()}>
                    加载更多账号
                  </Button>
                )}
                {current && (
                  <form
                    aria-label="保存个人策略"
                    onSubmit={(e) => void save(e)}
                  >
                    <div className="parameter-grid">
                      {Object.entries(fields).map(([key, label]) => (
                        <Field
                          key={key}
                          label={label}
                          type="number"
                          min={
                            [
                              "imageLimit",
                              "attemptsLimit",
                              "storageLimit",
                            ].includes(key)
                              ? 0
                              : 1
                          }
                          value={Number(current[key as keyof ImagePolicy])}
                          required
                          onChange={(e) =>
                            patch({ [key]: Number(e.target.value) })
                          }
                        />
                      ))}
                    </div>
                    <ChoiceField
                      label="最高质量"
                      value={current.maxQuality}
                      onValueChange={(v) =>
                        patch({ maxQuality: v as ImagePolicy["maxQuality"] })
                      }
                      options={["low", "medium", "high"].map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                    <label className="field">
                      <span>允许的图像模型</span>
                      <Select
                        mode="multiple"
                        aria-label="允许的图像模型"
                        value={current.allowedModels}
                        options={choices}
                        onChange={(allowedModels) => patch({ allowedModels })}
                        placeholder="留空跟随全局图像池"
                      />
                    </label>
                    <p className="hint">
                      留空使用全局开放范围；选定后只允许这些模型。降额不撤销已接受任务。
                    </p>
                    <Button className="primary" disabled={busy}>
                      保存个人策略
                    </Button>
                  </form>
                )}
              </section>
            ),
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
