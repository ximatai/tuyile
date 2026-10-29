import {
  imageCapabilityDefaults,
  type ImageCapability,
} from "@tuyile/contracts";
import { ExtensionsAdmin } from "./extensions-admin";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ProviderView,
  ReviewTask,
  UserView,
  ImagePolicy,
} from "@tuyile/contracts";
import {
  Collapse,
  Button,
  Field,
  Notice,
  useConfirm,
  ChoiceField,
  Checkbox,
} from "@tuyile/ui";
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
export function ImageAdminPage({ csrfToken }: { csrfToken: string }) {
  const [providerVersion, setProviderVersion] = useState(0);
  const [modelsText, setModelsText] = useState("");
  const [capabilities, setCapabilities] = useState<
    Record<string, ImageCapability>
  >({});
  const [sizeDrafts, setSizeDrafts] = useState<Record<string, string>>({});
  const models = [
    ...new Set(
      modelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  function capability(model: string, patch: Partial<ImageCapability>) {
    setCapabilities((v) => ({
      ...v,
      [model]: { ...(v[model] ?? imageCapabilityDefaults(model)), ...patch },
    }));
  }
  const confirm = useConfirm();
  const [allowedText, setAllowedText] = useState("");
  const [providers, setProviders] = useState<ProviderView[]>([]),
    [review, setReview] = useState<ReviewTask[]>([]),
    [users, setUsers] = useState<UserView[]>([]),
    [user, setUser] = useState(""),
    [policy, setPolicy] = useState<ImagePolicy | null>(null),
    [mode, setMode] = useState("openai"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function refresh() {
    const [p, r] = await Promise.all([
      client(csrfToken)<{ providers: ProviderView[] }>(
        "/image-admin/providers",
      ),
      client(csrfToken)<{ tasks: ReviewTask[] }>("/image-admin/review"),
    ]);
    setProviders(p.providers);
    setReview(r.tasks);
  }
  useEffect(() => {
    let alive = true;
    void Promise.all([
      client(csrfToken)<{ users: UserView[] }>("/admin/users"),
      refresh(),
    ])
      .then(([u]) => {
        if (alive) {
          setUsers(u.users);
          setUser(u.users[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [csrfToken]);
  useEffect(() => {
    if (!user) return;
    const c = new AbortController();
    setPolicy(null);
    void client(csrfToken)<ImagePolicy>(
      `/image-admin/policies/${user}`,
      undefined,
      c.signal,
    )
      .then((p) => {
        if (!c.signal.aborted) {
          setPolicy(p);
          setAllowedText(p.allowedModels.join(","));
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [csrfToken, user]);
  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await refresh();
      setMessage("已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function provider(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    void run(async () => {
      await client(csrfToken)("/image-admin/providers", {
        mode,
        baseUrl: mode === "fake" ? "" : f.get("baseUrl"),
        models,
        capabilities: models.map((m) => ({
          ...(capabilities[m] ?? imageCapabilityDefaults(m)),
          sizes: (sizeDrafts[m] ?? capabilities[m]?.sizes.join(",") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })),
        apiKey: f.get("apiKey") || undefined,
        preserveKey: f.get("preserveKey") === "on",
      });
      setProviderVersion((v) => v + 1);
      setModelsText("");
      setCapabilities({});
      setSizeDrafts({});
    });
  }
  function savePolicy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!policy) return;
    void run(() =>
      client(csrfToken)(`/image-admin/policies/${user}`, {
        ...policy,
        allowedModels: allowedText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    );
  }
  async function moreUsers() {
    try {
      const result = await client(csrfToken)<{ users: UserView[] }>(
        `/admin/users?offset=${users.length}`,
      );
      setUsers((v) => [...v, ...result.users]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="image-admin">
      <p className="eyebrow">管理</p>
      <h1>创作服务与额度</h1>
      <p className="muted">
        统一维护模型服务、用户限制与未知结果。这里不展示其他用户的提示词、图片或正文。
      </p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <section className="settings-section">
        <h2>模型服务</h2>
        <form
          key={providerVersion}
          onSubmit={provider}
          aria-label="保存图片服务"
        >
          <ChoiceField
            label="服务类型"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "openai", label: "OpenAI 兼容服务" },
              { value: "fake", label: "本地测试服务（不调用真实模型）" },
            ]}
          />
          {mode === "openai" && (
            <>
              <Field
                label="服务地址"
                name="baseUrl"
                type="url"
                placeholder="https://api.openai.com/v1"
                required
              />
              <Field
                label="API Key"
                name="apiKey"
                type="password"
                autoComplete="new-password"
              />
              <Checkbox name="preserveKey">
                显式沿用当前 Key（仅同一服务地址）
              </Checkbox>
            </>
          )}
          <Field
            label="允许的模型（英文逗号分隔）"
            name="models"
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder={mode === "fake" ? "test-image" : "模型 ID"}
            required
          />
          <p className="hint">
            按服务商文档声明各模型支持的规格；这里的声明不代表已完成真实模型测试。
          </p>
          <Collapse
            items={models.map((model) => {
              const cap = capabilities[model] ?? imageCapabilityDefaults(model);
              return {
                key: model,
                label: `${model} 的能力声明`,
                children: (
                  <div className="settings-fields">
                    <Checkbox
                      checked={cap.generation}
                      onChange={(e) =>
                        capability(model, { generation: e.target.checked })
                      }
                    >
                      允许无参考图生成
                    </Checkbox>
                    <Checkbox
                      checked={cap.editing}
                      onChange={(e) =>
                        capability(model, { editing: e.target.checked })
                      }
                    >
                      允许参考图创作
                    </Checkbox>
                    <Field
                      label="模型最大边长"
                      type="number"
                      min={256}
                      max={8192}
                      value={cap.maxEdge}
                      onChange={(e) =>
                        capability(model, { maxEdge: Number(e.target.value) })
                      }
                    />
                    <Field
                      label="模型最大像素数"
                      type="number"
                      min={65536}
                      max={32000000}
                      value={cap.maxPixels}
                      onChange={(e) =>
                        capability(model, { maxPixels: Number(e.target.value) })
                      }
                    />
                    <Field
                      label="最多参考图"
                      type="number"
                      min={0}
                      max={4}
                      value={cap.maxReferences}
                      onChange={(e) =>
                        capability(model, {
                          maxReferences: Number(e.target.value),
                        })
                      }
                    />
                    <Field
                      label="限定尺寸（如 1024x1024，英文逗号分隔；留空仅按上限校验）"
                      value={sizeDrafts[model] ?? cap.sizes.join(",")}
                      onChange={(e) =>
                        setSizeDrafts((drafts) => ({
                          ...drafts,
                          [model]: e.target.value,
                        }))
                      }
                    />
                    <div className="field">
                      <span>支持质量</span>
                      <Checkbox.Group
                        value={cap.qualities}
                        options={[
                          { label: "低", value: "low" },
                          { label: "中", value: "medium" },
                          { label: "高", value: "high" },
                        ]}
                        onChange={(v) =>
                          capability(model, {
                            qualities: v as ImageCapability["qualities"],
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <span>支持格式</span>
                      <Checkbox.Group
                        value={cap.formats}
                        options={["png", "jpeg", "webp"]}
                        onChange={(v) =>
                          capability(model, {
                            formats: v as ImageCapability["formats"],
                          })
                        }
                      />
                    </div>
                  </div>
                ),
              };
            })}
          />
          <p className="hint">
            保存仅新增配置版本，不进行模型调用。已接受任务保持原版本；需要停止旧版本时使用“紧急停用”。本地测试服务在正式生产模式不可用。
          </p>
          <Button className="primary" disabled={busy}>
            保存图片服务
          </Button>
        </form>
        <ul className="provider-versions">
          {providers.map((p) => (
            <li key={p.id}>
              <div>
                <strong>
                  {p.mode === "fake" ? "本地测试服务" : "兼容图片服务"}
                </strong>
                <p className="hint">
                  {p.models.join("、")} ·{" "}
                  {p.revoked ? "已停用" : p.active ? "当前版本" : "历史版本"}
                  {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                </p>
              </div>
              <Button
                disabled={busy || p.revoked}
                onClick={async () => {
                  if (
                    await confirm(
                      "停用此版本？未发出的调用会停止，在途调用尽力取消。",
                    )
                  )
                    void run(() =>
                      client(csrfToken)(
                        `/image-admin/providers/${p.id}/revoke`,
                        {},
                      ),
                    );
                }}
              >
                紧急停用
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-section">
        <h2>个人策略</h2>
        <ChoiceField
          label="选择账号"
          value={user}
          onValueChange={setUser}
          options={users.map((u) => ({ value: u.id, label: u.username }))}
        />
        {users.length >= 50 && (
          <Button onClick={() => void moreUsers()}>加载更多账号</Button>
        )}
        {policy && (
          <form onSubmit={savePolicy} aria-label="保存个人策略">
            <div className="parameter-grid">
              {Object.entries(fields).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  type="number"
                  min={
                    key === "imageLimit" ||
                    key === "attemptsLimit" ||
                    key === "storageLimit"
                      ? 0
                      : 1
                  }
                  required
                  value={Number(policy[key as keyof ImagePolicy])}
                  onChange={(e) =>
                    setPolicy((p) =>
                      p ? { ...p, [key]: Number(e.target.value) } : p,
                    )
                  }
                />
              ))}
            </div>
            <ChoiceField
              label="最高质量"
              value={policy.maxQuality}
              onValueChange={(v) =>
                setPolicy((p) =>
                  p ? { ...p, maxQuality: v as ImagePolicy["maxQuality"] } : p,
                )
              }
              options={[
                { value: "low", label: "低" },
                { value: "medium", label: "中" },
                { value: "high", label: "高" },
              ]}
            />
            <Field
              label="个人允许模型（留空跟随全局）"
              value={allowedText}
              onChange={(e) => setAllowedText(e.target.value)}
            />
            <p className="hint">
              降低额度不会删除已有作品，也不撤销已接受的图片预留。当前日超限时阻止新提交。
            </p>
            <Button className="primary" disabled={busy}>
              保存个人策略
            </Button>
          </form>
        )}
      </section>
      <ExtensionsAdmin csrfToken={csrfToken} />
      <section className="settings-section">
        <h2>结果待核验</h2>
        <p className="hint">
          核验确认无法取得图片后释放对应预留。上游可能已收费，但没有本地成功图片不扣图片次数。此操作不生成图片、不返还调用尝试次数。处理原因只用于审计。
        </p>
        {!review.length && <p>暂无待核验任务。</p>}
        {review.map((t) => (
          <form
            key={t.id}
            aria-label="核验任务"
            className="review-task"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() =>
                client(csrfToken)(`/image-admin/review/${t.id}`, {
                  confirmed: 0,
                  reason: f.get("reason"),
                }),
              );
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
            <Button disabled={busy}>确认无法取得图片并释放预留</Button>
          </form>
        ))}
      </section>
    </section>
  );
}
