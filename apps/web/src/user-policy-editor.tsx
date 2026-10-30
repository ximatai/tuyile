import { useQuery } from "@tanstack/react-query";
import { useState, useId, type FormEvent } from "react";
import type { ImagePolicy, ModelCatalogSnapshot } from "@tuyile/contracts";
import {
  Button,
  Field,
  ChoiceField,
  Notice,
  Select,
  Collapse,
  Radio,
  Checkbox,
  Input,
} from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
const GB = 1024 ** 3;
const advancedFields = [
  { key: "maxCount", label: "每次最多生成（张）", min: 1, max: 16 },
  { key: "attemptsLimit", label: "每日模型调用上限（次）", min: 0, max: 10000 },
  { key: "concurrency", label: "同时执行的任务数", min: 1, max: 8 },
  { key: "queueLimit", label: "最多排队的任务数", min: 1, max: 100 },
  { key: "maxEdge", label: "图片最大边长（px）", min: 256, max: 8192 },
  { key: "maxPixels", label: "图片最大像素数", min: 65536, max: 32000000 },
] as const;

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
  const quotaInputId = useId();
  const state = useSessionState(),
    api = client(csrfToken);
  const [finiteQuota, setFiniteQuota] = useState(100);
  const [modelScope, setModelScope] = useState<"all" | "custom" | null>(null);
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
    if (
      !current ||
      busy ||
      (modelScope === "custom" && !current.allowedModels.length)
    )
      return;
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
  const scope =
    modelScope ?? (current?.allowedModels.length ? "custom" : "all");
  const incompleteScope = scope === "custom" && !current?.allowedModels.length;
  return (
    <section className="user-policy-editor" aria-label="额度与模型">
      <h3>使用额度</h3>
      {(error || policy.error || catalog.error) && (
        <Notice error>
          {error || policy.error?.message || catalog.error?.message}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}
      {policy.isPending && <p role="status">正在加载配置…</p>}
      {current && (
        <form aria-label="保存用户配置" onSubmit={(e) => void save(e)}>
          <div className="parameter-grid user-policy-quota-grid">
            <div className="field">
              <div className="user-policy-quota-heading">
                <label htmlFor={quotaInputId}>每日图片额度</label>
                <Checkbox
                  checked={current.imageLimit === -1}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFiniteQuota(current.imageLimit);
                      patch({ imageLimit: -1 });
                    } else patch({ imageLimit: finiteQuota });
                  }}
                >
                  不限额
                </Checkbox>
              </div>
              <Input
                id={quotaInputId}
                type="number"
                min={0}
                max={10000}
                required={current.imageLimit !== -1}
                disabled={current.imageLimit === -1 || busy}
                value={current.imageLimit === -1 ? "" : current.imageLimit}
                placeholder={current.imageLimit === -1 ? "不限额" : undefined}
                onChange={(e) => patch({ imageLimit: Number(e.target.value) })}
              />
            </div>
            <Field
              label="存储上限（GB）"
              title="1 GB 按 1024³ 字节计算"
              type="number"
              min={0}
              max={1024}
              step="any"
              required
              value={current.storageLimit / GB}
              onChange={(e) =>
                patch({ storageLimit: Math.round(Number(e.target.value) * GB) })
              }
            />
          </div>
          <h3>模型权限</h3>
          <Radio.Group
            aria-label="模型使用范围"
            value={scope}
            onChange={(e) => {
              setModelScope(e.target.value);
              if (e.target.value === "all") patch({ allowedModels: [] });
            }}
            options={[
              { value: "all", label: "全部开放模型" },
              { value: "custom", label: "指定模型" },
            ]}
          />
          {scope === "custom" && (
            <label className="field user-policy-models">
              <span>允许使用的图片模型</span>
              <Select
                mode="multiple"
                aria-label="允许使用的图片模型"
                value={current.allowedModels}
                options={choices}
                onChange={(allowedModels) => patch({ allowedModels })}
                placeholder="选择模型"
                status={incompleteScope ? "warning" : undefined}
              />
            </label>
          )}
          <p className="hint">
            {scope === "all"
              ? "跟随模型服务中的开放范围。"
              : "仅允许使用选中的模型。"}
          </p>
          <Collapse
            ghost
            items={[
              {
                key: "advanced",
                label: "高级设置",
                children: (
                  <>
                    <p className="hint">一般无需修改，保留现有设置即可。</p>
                    <div className="parameter-grid">
                      {advancedFields.map(({ key, label, min, max }) => (
                        <Field
                          key={key}
                          label={label}
                          type="number"
                          min={min}
                          max={max}
                          required
                          value={current[key]}
                          onChange={(e) =>
                            patch({ [key]: Number(e.target.value) })
                          }
                        />
                      ))}
                    </div>
                    <ChoiceField
                      label="图片质量上限"
                      value={current.maxQuality}
                      onValueChange={(v) =>
                        patch({ maxQuality: v as ImagePolicy["maxQuality"] })
                      }
                      options={[
                        { value: "low", label: "低" },
                        { value: "medium", label: "中" },
                        { value: "high", label: "高" },
                      ]}
                    />
                  </>
                ),
              },
            ]}
          />
          <div className="user-policy-save">
            <Button
              className="primary"
              disabled={busy || !dirty || incompleteScope}
            >
              {busy ? "正在保存…" : "保存用户配置"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
