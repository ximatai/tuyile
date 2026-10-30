import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { ImagePolicy, ModelCatalogSnapshot } from "@tuyile/contracts";
import { Button, Field, ChoiceField, Notice, Select } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
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

export function UserPolicyEditor({
  userId,
  csrfToken,
  onDirtyChange,
  onBusyChange,
}: {
  userId: string;
  csrfToken: string;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const state = useSessionState(),
    api = client(csrfToken);
  const [draft, setDraft] = useState<ImagePolicy | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const policy = useQuery({
    queryKey: state.key("image-policy", userId),
    queryFn: ({ signal }) =>
      api<ImagePolicy>(`/image-admin/policies/${userId}`, undefined, signal),
    refetchOnWindowFocus: false,
  });
  const catalog = useQuery({
    queryKey: state.key("model-catalog"),
    queryFn: ({ signal }) =>
      api<ModelCatalogSnapshot>("/model-admin/catalog", undefined, signal),
  });
  const current = draft ?? policy.data;
  const dirty =
    !!draft && JSON.stringify(draft) !== JSON.stringify(policy.data);
  function patch(v: Partial<ImagePolicy>) {
    if (current && !busy) {
      const next = { ...current, ...v };
      setDraft(next);
      onDirtyChange(JSON.stringify(next) !== JSON.stringify(policy.data));
      setMessage("");
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!current || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await api(`/image-admin/policies/${userId}`, current);
      state.queries.setQueryData(state.key("image-policy", userId), current);
      await state.queries.invalidateQueries({
        queryKey: state.key("image-policy", userId),
      });
      await state.queries.invalidateQueries({ queryKey: state.key("usage") });
      setDraft(null);
      onDirtyChange(false);
      setMessage("已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const choices =
    catalog.data?.entries
      .filter((e) => e.kind === "image")
      .map((e) => ({
        value: e.id,
        label: `${e.modelId} · ${catalog.data!.services.find((s) => s.id === e.serviceId)?.name ?? "服务不可用"}`,
      })) ?? [];
  return (
    <section className="user-policy-editor" aria-label="额度与模型">
      <h3>额度与限制</h3>
      {(error || policy.error || catalog.error) && (
        <Notice error>
          {error || policy.error?.message || catalog.error?.message}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}
      {policy.isPending && <p role="status">正在加载配置…</p>}
      {current && (
        <form aria-label="保存用户配置" onSubmit={(e) => void save(e)}>
          <div className="parameter-grid">
            {Object.entries(fields).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                type="number"
                min={
                  ["imageLimit", "attemptsLimit", "storageLimit"].includes(key)
                    ? 0
                    : 1
                }
                value={Number(current[key as keyof ImagePolicy])}
                required
                onChange={(e) => patch({ [key]: Number(e.target.value) })}
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
              label: (
                { low: "低", medium: "中", high: "高" } as Record<
                  string,
                  string
                >
              )[value],
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
          <div className="user-policy-save">
            <Button className="primary" disabled={busy || !dirty}>
              {busy ? "正在保存…" : "保存用户配置"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
