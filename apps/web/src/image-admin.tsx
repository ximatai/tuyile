import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useSessionState } from "./session-state";
import { OperationsAdmin } from "./operations-admin";
import {
  imageCapabilityDefaults,
  type ImageCapability,
} from "@tuyile/contracts";
import { ExtensionsAdmin } from "./extensions-admin";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ProviderView,
  ReviewTask,
  UsersPage,
  ImagePolicy,
} from "@tuyile/contracts";
import {
  Collapse,
  Tabs,
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
  const [section, setSection] = useState("images");
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
  const [policyOwner, setPolicyOwner] = useState("");
  const [user, setUser] = useState(""),
    [policy, setPolicy] = useState<ImagePolicy | null>(null),
    [mode, setMode] = useState("openai"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const state = useSessionState();
  const api = client(csrfToken);
  const providersQuery = useQuery({
    queryKey: state.key("image-providers"),
    queryFn: ({ signal }) =>
      api<{ providers: ProviderView[] }>(
        "/image-admin/providers",
        undefined,
        signal,
      ),
  });
  const reviewQuery = useQuery({
    queryKey: state.key("image-review"),
    queryFn: ({ signal }) =>
      api<{ tasks: ReviewTask[] }>("/image-admin/review", undefined, signal),
  });
  const usersQuery = useInfiniteQuery({
    queryKey: state.key("admin-users"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<UsersPage>(`/admin/users?offset=${pageParam}`, undefined, signal),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const providers = providersQuery.data?.providers ?? [],
    review = reviewQuery.data?.tasks ?? [];
  const users = [
    ...new Map(
      (usersQuery.data?.pages.flatMap((p) => p.users) ?? []).map((u) => [
        u.id,
        u,
      ]),
    ).values(),
  ];
  const selectedUser = user || users[0]?.id || "";
  const policyQuery = useQuery({
    queryKey: state.key("image-policy", selectedUser),
    enabled: !!selectedUser,
    queryFn: ({ signal }) =>
      api<ImagePolicy>(
        `/image-admin/policies/${selectedUser}`,
        undefined,
        signal,
      ),
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setPolicyOwner(selectedUser);
    setPolicy(policyQuery.data ?? null);
    setAllowedText(policyQuery.data?.allowedModels.join(",") ?? "");
  }, [selectedUser, policyQuery.data]);
  async function refresh() {
    await Promise.all([
      providersQuery.refetch({ throwOnError: true }),
      reviewQuery.refetch({ throwOnError: true }),
      state.queries.invalidateQueries({ queryKey: state.key("models") }),
      state.queries.invalidateQueries({ queryKey: state.key("usage") }),
      state.queries.invalidateQueries({
        queryKey: state.key("admin-summary"),
      }),
    ]);
  }
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
    if (!policy || policyOwner !== selectedUser) return;
    void run(async () => {
      await client(csrfToken)(`/image-admin/policies/${selectedUser}`, {
        ...policy,
        allowedModels: allowedText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      await state.queries.invalidateQueries({
        queryKey: state.key("image-policy", selectedUser),
      });
    });
  }
  async function moreUsers() {
    try {
      await usersQuery.fetchNextPage({ throwOnError: true });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const imagesContent = (
    <>
      <section className="settings-section current-provider">
        <h2>当前服务</h2>
        {providers.find((p) => p.active && !p.revoked) ? (
          (() => {
            const current = providers.find((p) => p.active && !p.revoked)!;
            return (
              <dl className="provider-summary">
                <dt>服务地址</dt>
                <dd>{current.baseUrl || "本地合成测试"}</dd>
                <dt>模型</dt>
                <dd>{current.models.join("、")}</dd>
                <dt>模式</dt>
                <dd>{current.mode === "fake" ? "本地测试" : "OpenAI 兼容"}</dd>
              </dl>
            );
          })()
        ) : (
          <p className="hint">尚未配置可用图片服务，请先保存服务版本。</p>
        )}
      </section>
      <section className="settings-section">
        <h2>新服务版本</h2>
        <p className="hint">
          保存新版本不会改变已接受的任务。密钥仅在服务端加密保存，不返回浏览器。
        </p>
        <form
          key={providerVersion}
          onSubmit={provider}
          className="provider-form"
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
            <Field
              label="服务地址"
              name="baseUrl"
              type="url"
              placeholder="https://api.openai.com/v1"
              required
            />
          )}
          <Field
            label="允许的模型（英文逗号分隔）"
            name="models"
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder={mode === "fake" ? "test-image" : "模型 ID"}
            required
          />
          {mode === "openai" && (
            <div className="provider-key-field">
              <Field
                label="API Key"
                name="apiKey"
                type="password"
                autoComplete="new-password"
              />
              <Checkbox name="preserveKey">
                显式沿用当前 Key（仅同一服务地址）
              </Checkbox>
            </div>
          )}
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
                        capability(model, {
                          maxPixels: Number(e.target.value),
                        })
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
    </>
  );
  const policiesContent = (
    <>
      <section className="settings-section">
        <h2>个人策略</h2>
        <ChoiceField
          label="选择账号"
          value={selectedUser}
          onValueChange={setUser}
          options={users.map((u) => ({ value: u.id, label: u.username }))}
        />
        {usersQuery.hasNextPage && (
          <Button onClick={() => void moreUsers()}>加载更多账号</Button>
        )}
        {policy && policyOwner === selectedUser && (
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
    </>
  );
  const extensionsContent = (
    <>
      <ExtensionsAdmin csrfToken={csrfToken} />
    </>
  );
  const operationsContent = (
    <>
      <OperationsAdmin />
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
    </>
  );
  return (
    <section className="image-admin">
      <h1>图片服务</h1>
      <p className="muted">管理图片与规划服务、执行边界和可扩展技能。</p>
      {(error ||
        providersQuery.error ||
        reviewQuery.error ||
        usersQuery.error ||
        policyQuery.error) && (
        <Notice error>
          {error ||
            providersQuery.error?.message ||
            reviewQuery.error?.message ||
            usersQuery.error?.message ||
            policyQuery.error?.message}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}
      <Tabs
        activeKey={section}
        onChange={setSection}
        items={[
          {
            key: "images",
            label: "图片服务",
            children: imagesContent,
            forceRender: true,
          },
          {
            key: "extensions",
            label: "规划与技能",
            children: extensionsContent,
            forceRender: true,
          },
          {
            key: "policies",
            label: "用户策略",
            children: policiesContent,
            forceRender: true,
          },
          {
            key: "operations",
            label: "运行与核验",
            children: operationsContent,
            forceRender: true,
          },
        ]}
      />
    </section>
  );
}
