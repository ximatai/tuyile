import {
  recommendedModelCapabilities,
  conversationModelKnowledge,
} from "./model-recommendations";
import {
  imageModelKnowledge,
  imageDeclarationWithinKnownLimits,
} from "@tuyile/contracts";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type ModelCatalogSnapshot,
  type ModelServiceView,
  type ModelServiceInput,
  type PoolEntryInput,
  type ModelKind,
  poolEntryInput,
} from "@tuyile/contracts";
import {
  Button,
  Collapse,
  ChoiceField,
  Field,
  Checkbox,
  Notice,
  Table,
  Drawer,
  Tag,
  Radio,
  Input,
  Select,
  ControlScope,
  Affix,
  Dropdown,
  Tooltip,
  useConfirm,
} from "@tuyile/ui";
import { MoreHorizontal } from "lucide-react";
import { HelpPopover } from "./interface-help";
import { useSessionState } from "./session-state";
import { client } from "./api";
export function ModelServicesAdmin() {
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    confirm = useConfirm();
  const query = useQuery({
    queryKey: state.key("model-catalog"),
    queryFn: ({ signal }) =>
      api<ModelCatalogSnapshot>("/model-admin/catalog", undefined, signal),
  });
  const [addingKind, setAddingKind] = useState<ModelKind>("conversation");
  const [adding, setAdding] = useState<ModelKind | null>(null);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [draft, setDraft] = useState<{
      revision: number;
      entries: PoolEntryInput[];
    } | null>(null),
    [editor, setEditor] = useState<Partial<ModelServiceInput> | null>(null),
    [advanced, setAdvanced] = useState<PoolEntryInput | null>(null),
    [sizes, setSizes] = useState(""),
    [manual, setManual] = useState(false),
    [manualId, setManualId] = useState("");
  const data = query.data,
    entries = draft?.entries ?? data?.entries ?? [],
    services = data?.services ?? [],
    service =
      services.find((s) => s.id === selected) ??
      services.find((s) => !s.revoked) ??
      services[0];
  async function refresh() {
    await Promise.all([
      query.refetch({ throwOnError: true }),
      ...[
        "usage",
        "model-pools",
        "planning-usage",
        "image-providers",
        "planning-providers",
      ].map((key) =>
        state.queries.invalidateQueries({ queryKey: state.key(key) }),
      ),
    ]);
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change(next: PoolEntryInput[]) {
    setDraft({ revision: draft?.revision ?? data!.revision, entries: next });
    setMessage("");
  }
  function add(model: string, kind: ModelKind) {
    if (!service) return;
    const exists = entries.find(
      (e) =>
        e.serviceId === service.id && e.modelId === model && e.kind === kind,
    );
    if (exists) return;
    change([
      ...entries,
      {
        id: crypto.randomUUID(),
        serviceId: service.id,
        modelId: model,
        kind,
        enabled: true,
        isDefault: !entries.some((e) => e.kind === kind && e.enabled),
        ...recommendedModelCapabilities(model, kind),
      },
    ]);
  }
  function editEntry(id: string, patch: Partial<PoolEntryInput>) {
    change(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  async function publish() {
    await run(async () => {
      for (const kind of ["image", "conversation"] as const) {
        const list = entries.filter((e) => e.kind === kind && e.enabled);
        if (list.length && list.filter((e) => e.isDefault).length !== 1)
          throw Error(
            `请为${kind === "image" ? "图像生成" : "对话"}模型池指定一个默认模型。`,
          );
      }
      await api("/model-admin/pools", { revision: draft!.revision, entries });
      setDraft(null);
      setMessage("模型开放配置已保存，新的创作可以使用。");
    });
  }
  function editService(s?: ModelServiceView) {
    setManaging(false);
    setError("");
    setEditor(
      s
        ? {
            id: s.id,
            revision: s.revision,
            name: s.name,
            mode: s.mode,
            baseUrl: s.baseUrl,
            preserveKey: true,
          }
        : {
            name: "",
            mode: "openai",
            baseUrl: "https://api.openai.com/v1",
            preserveKey: false,
          },
    );
  }
  async function saveService(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    await run(async () => {
      const saved = await api<ModelServiceView>(
        "/model-admin/services",
        editor,
      );
      setSelected(saved.id);
      setEditor(null);
      setMessage("服务已保存，可以获取模型列表。");
    });
  }
  async function toggleService(
    s: ModelServiceView,
    enabled: boolean,
    revoke = false,
  ) {
    if (
      revoke &&
      !(await confirm(
        "紧急撤销此服务？该服务尚未发出的调用将停止，在途请求可能仍计费。此撤销不可恢复。",
      ))
    )
      return;
    await run(async () => {
      await api(`/model-admin/services/${s.id}/state`, {
        revision: s.revision,
        enabled,
        revoke,
      });
      setMessage(
        revoke
          ? "服务已撤销。"
          : enabled
            ? "服务已启用，请检查并开放需要的模型。"
            : "服务已停用，已接受任务仍按绑定版本处理。",
      );
    });
  }
  const candidates = (data?.models ?? []).filter(
    (m) =>
      m.serviceId === service?.id &&
      m.modelId.toLowerCase().includes(search.toLowerCase()),
  );
  if (query.isPending) return <p role="status">正在读取模型服务…</p>;
  return (
    <ControlScope componentDisabled={busy}>
      <div className="model-services-admin">
        {(error || query.error) && (
          <Notice error>{error || query.error?.message}</Notice>
        )}
        {message && <Notice>{message}</Notice>}
        {!data?.managed && (
          <Notice>
            现有服务仍在正常工作。
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/model-admin/bootstrap", {});
                  setMessage("现有服务和开放模型已接入。");
                })
              }
            >
              接入现有配置
            </Button>
          </Notice>
        )}
        <section className="model-service-overview" aria-label="服务接入">
          <ChoiceField
            label="当前服务"
            hideLabel
            value={service?.id ?? ""}
            onValueChange={setSelected}
            options={services.map((s) => ({
              value: s.id,
              label: `${s.name}${s.revoked ? "（已撤销）" : !s.enabled ? "（已停用）" : ""}`,
            }))}
          />
          <Tag>
            {service
              ? service.revoked
                ? "已撤销"
                : service.enabled
                  ? "已配置"
                  : "已停用"
              : "未接入服务"}
          </Tag>
          <Button type="button" onClick={() => setManaging(true)}>
            管理服务
          </Button>
        </section>
        <div className="model-catalog-grid">
          {(["conversation", "image"] as const).map((kind) => {
            const list = entries
              .filter((e) => e.kind === kind)
              .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
            return (
              <section
                className="model-pool-panel"
                aria-label={kind === "image" ? "图像生成模型池" : "对话模型池"}
                key={kind}
              >
                <div className="model-pool-heading">
                  <h2>
                    {kind === "image" ? "图片生成模型" : "对话模型"}
                    <span className="model-pool-count">{list.length}</span>
                  </h2>
                  <Button
                    type="button"
                    aria-label={
                      kind === "image" ? "添加图片生成模型" : "添加对话模型"
                    }
                    onClick={() => {
                      setSearch("");
                      setAddingKind(kind);
                      setAdding(kind);
                    }}
                  >
                    添加模型
                  </Button>
                </div>
                <Radio.Group
                  aria-label={`${kind === "image" ? "图像生成" : "对话"}默认模型`}
                  value={list.find((e) => e.isDefault)?.id}
                  onChange={(event) =>
                    change(
                      entries.map((e) =>
                        e.kind === kind
                          ? { ...e, isDefault: e.id === event.target.value }
                          : e,
                      ),
                    )
                  }
                >
                  {list.map((e) => (
                    <article key={e.id} className="model-pool-entry">
                      <div className="model-pool-entry-title">
                        <strong>{e.modelId}</strong>
                        <Checkbox
                          aria-label={`开放 ${kind} ${e.id}`}
                          checked={e.enabled}
                          disabled={
                            busy ||
                            services.find((s) => s.id === e.serviceId)
                              ?.revoked ||
                            !services.find((s) => s.id === e.serviceId)?.enabled
                          }
                          onChange={(ev) =>
                            editEntry(e.id, {
                              enabled: ev.target.checked,
                              isDefault: ev.target.checked
                                ? e.isDefault
                                : false,
                            })
                          }
                        >
                          开放
                        </Checkbox>
                      </div>
                      <span className="hint">
                        {services.find((s) => s.id === e.serviceId)?.name ??
                          "服务不可用"}
                      </span>
                      <div className="model-capability-tags">
                        {kind === "conversation" ? (
                          <Tag>
                            {e.conversation?.supportsImages
                              ? "支持参考图理解"
                              : "仅文本输入"}
                          </Tag>
                        ) : (
                          <>
                            <Tag>
                              {e.image?.generation ? "文生图" : "不支持文生图"}
                            </Tag>
                            <Tag>
                              {e.image?.editing ? "参考图编辑" : "无参考图编辑"}
                            </Tag>
                          </>
                        )}
                      </div>
                      <div className="model-entry-actions">
                        <Radio value={e.id} disabled={busy || !e.enabled}>
                          默认
                        </Radio>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setAdvanced(structuredClone(e));
                            setSizes(e.image?.sizes.join(",") ?? "");
                          }}
                        >
                          能力设置
                        </Button>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            change(entries.filter((v) => v.id !== e.id))
                          }
                        >
                          移出
                        </Button>
                      </div>
                    </article>
                  ))}
                </Radio.Group>
                {!list.length && (
                  <div className="model-pool-empty">
                    点击“添加模型”配置此模型池
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {draft && (
          <Affix offsetBottom={16}>
            <footer className="model-pool-save">
              <span>修改尚未发布</span>
              <div className="actions">
                <Button
                  type="button"
                  disabled={busy || !draft}
                  onClick={() => {
                    setDraft(null);
                    setError("");
                  }}
                >
                  放弃修改
                </Button>
                <Button
                  type="button"
                  className="primary"
                  disabled={busy || !draft}
                  onClick={() => void publish()}
                >
                  保存开放配置
                </Button>
              </div>
            </footer>
          </Affix>
        )}
        <Drawer
          title={addingKind === "image" ? "添加图片生成模型" : "添加对话模型"}
          open={!!adding}
          size={640}
          onClose={() => {
            if (!busy) setAdding(null);
          }}
          destroyOnHidden
        >
          {error && <Notice error>{error}</Notice>}
          <section className="model-catalog-candidates" aria-label="可用模型">
            <div className="model-pool-heading">
              <div className="heading-with-help">
                <HelpPopover title="模型开放规则">
                  获取目录不会调用模型。将候选加入相应模型池，核对能力后保存才向用户开放。目录刷新不会改变已开放范围，已提交任务保留原配置。
                </HelpPopover>
              </div>
              <span>{service ? candidates.length : 0} 个候选</span>
            </div>
            <ChoiceField
              label="候选模型服务"
              value={service?.id ?? ""}
              onValueChange={setSelected}
              options={services.map((s) => ({
                value: s.id,
                label: `${s.name}${s.revoked ? "（已撤销）" : !s.enabled ? "（已停用）" : ""}`,
              }))}
            />
            <Button
              className="primary"
              type="button"
              disabled={busy || !service || !service.enabled || service.revoked}
              onClick={() =>
                void run(async () => {
                  await api(`/model-admin/services/${service!.id}/refresh`, {});
                  setMessage("模型列表已更新，开放范围保持不变。");
                })
              }
            >
              {busy ? "正在处理…" : "获取模型"}
            </Button>
            <Input
              aria-label="筛选服务模型"
              placeholder="按模型名称筛选"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
            />
            <Table
              rowKey="modelId"
              size="small"
              dataSource={candidates}
              pagination={{
                pageSize: 6,
                showSizeChanger: false,
                showLessItems: true,
              }}
              scroll={{ y: 330 }}
              columns={[
                {
                  title: "模型",
                  dataIndex: "modelId",
                  render: (_: unknown, m: (typeof candidates)[number]) => (
                    <div className="model-identifier">
                      <strong>{m.modelId}</strong>
                      {!m.present && <small>最近未发现</small>}
                      {m.manual && <small>已手动登记</small>}
                    </div>
                  ),
                },
                {
                  title: "加入",
                  width: 90,
                  render: (_: unknown, m: (typeof candidates)[number]) => (
                    <div className="model-add-actions">
                      <Button
                        type="button"
                        aria-label={`将 ${m.modelId} 加入${addingKind === "image" ? "图像生成" : "对话"}池`}
                        disabled={
                          busy ||
                          !service?.enabled ||
                          service.revoked ||
                          entries.some(
                            (e) =>
                              e.serviceId === service.id &&
                              e.modelId === m.modelId &&
                              e.kind === addingKind,
                          )
                        }
                        onClick={() => {
                          add(m.modelId, addingKind);
                          setAdding(null);
                        }}
                      >
                        {entries.some(
                          (e) =>
                            e.serviceId === service?.id &&
                            e.modelId === m.modelId &&
                            e.kind === addingKind,
                        )
                          ? "已添加"
                          : "添加"}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <Button
              type="button"
              disabled={busy || !service || service.revoked}
              onClick={() => {
                setError("");
                setManualId("");
                setManual(true);
              }}
            >
              手动登记模型
            </Button>
          </section>
        </Drawer>
        <Drawer
          title="管理服务"
          open={managing}
          size={600}
          onClose={() => setManaging(false)}
          destroyOnHidden
        >
          {error && <Notice error>{error}</Notice>}
          <section className="model-service-bar" aria-label="服务接入">
            <ChoiceField
              label="模型服务"
              hideLabel
              value={service?.id ?? ""}
              onValueChange={setSelected}
              options={services.map((s) => ({
                value: s.id,
                label: `${s.name}${s.revoked ? "（已撤销）" : !s.enabled ? "（已停用）" : ""}`,
              }))}
            />
            <div className="model-service-summary">
              {service ? (
                <>
                  <span>
                    {service.mode === "fake" ? "本地合成测试" : service.baseUrl}
                  </span>
                  <Tag>
                    {service.revoked
                      ? "已撤销"
                      : service.enabled
                        ? "已配置"
                        : "已停用"}
                  </Tag>
                </>
              ) : (
                <span>接入一个服务后，获取它提供的模型。</span>
              )}
            </div>
            <div className="actions">
              <Tooltip
                title={draft ? "先保存或放弃模型池修改" : undefined}
                trigger={["hover", "focus"]}
              >
                <span tabIndex={draft ? 0 : undefined}>
                  <Button
                    type="button"
                    disabled={busy || !!draft}
                    onClick={() => editService()}
                  >
                    新增服务
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                title={draft ? "先保存或放弃模型池修改" : undefined}
                trigger={["hover", "focus"]}
              >
                <span tabIndex={draft ? 0 : undefined}>
                  <Button
                    type="button"
                    disabled={busy || !!draft || !service || service.revoked}
                    onClick={() => editService(service)}
                  >
                    编辑服务
                  </Button>
                </span>
              </Tooltip>
            </div>
          </section>
          {service && (
            <Dropdown
              autoFocus
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "version",
                    label: `版本 ${service.revision}`,
                    disabled: true,
                  },
                  {
                    key: "updated",
                    label: service.catalogUpdatedAt
                      ? `最近获取 ${new Date(service.catalogUpdatedAt).toLocaleString("zh-CN")}`
                      : "尚未获取模型",
                    disabled: true,
                  },
                  { type: "divider" },
                  {
                    key: "state",
                    label: service.enabled ? "停用服务" : "启用服务",
                    disabled: busy || !!draft || service.revoked,
                    onClick: () =>
                      void toggleService(service, !service.enabled),
                  },
                  {
                    key: "revoke",
                    label: "紧急撤销",
                    danger: true,
                    disabled: busy || !!draft || service.revoked,
                    onClick: () => void toggleService(service, false, true),
                  },
                ],
              }}
            >
              <Button type="button" aria-label="更多服务操作" disabled={busy}>
                <MoreHorizontal size={16} />
                更多服务操作
              </Button>
            </Dropdown>
          )}{" "}
        </Drawer>
        <Drawer
          title={editor?.id ? "编辑模型服务" : "新增模型服务"}
          open={!!editor}
          size={520}
          footer={
            <Button
              className="primary"
              type="submit"
              form="model-service-editor"
              disabled={busy}
            >
              保存服务
            </Button>
          }
          onClose={() => {
            if (!busy) setEditor(null);
          }}
          destroyOnHidden
        >
          {error && <Notice error>{error}</Notice>}
          {editor && (
            <form
              onSubmit={(e) => void saveService(e)}
              aria-label="模型服务接入"
              id="model-service-editor"
            >
              <Field
                label="服务名称"
                required
                maxLength={80}
                value={editor.name ?? ""}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
              <ChoiceField
                label="接入协议"
                value={editor.mode ?? "openai"}
                onValueChange={(v) =>
                  setEditor({ ...editor, mode: v as "openai" | "fake" })
                }
                options={[
                  { value: "openai", label: "OpenAI 兼容协议" },
                  ...(data?.testingAllowed
                    ? [{ value: "fake", label: "本地合成测试（不调用模型）" }]
                    : []),
                ]}
              />
              {editor.mode !== "fake" && (
                <>
                  <Field
                    label="Base URL"
                    type="url"
                    required
                    value={editor.baseUrl ?? ""}
                    onChange={(e) =>
                      setEditor({ ...editor, baseUrl: e.target.value })
                    }
                  />
                  <Field
                    label="服务 API Key"
                    type="password"
                    autoComplete="new-password"
                    value={editor.apiKey ?? ""}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        apiKey: e.target.value || undefined,
                      })
                    }
                  />
                  {editor.id && (
                    <Checkbox
                      checked={editor.preserveKey ?? false}
                      onChange={(e) =>
                        setEditor({ ...editor, preserveKey: e.target.checked })
                      }
                    >
                      沿用现有 Key（仅地址和协议不变时）
                    </Checkbox>
                  )}
                </>
              )}
              <p className="hint">Key 加密保存。更改地址或协议后需重新填写。</p>
            </form>
          )}
        </Drawer>
        <Drawer
          title="手动登记模型"
          open={manual}
          onClose={() => {
            if (!busy) setManual(false);
          }}
          size={460}
          destroyOnHidden
        >
          {error && <Notice error>{error}</Notice>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/model-admin/services/${service!.id}/manual`, {
                  modelId: manualId,
                });
                setManual(false);
                setManualId("");
                setMessage("已登记为候选模型，尚未开放。");
              });
            }}
          >
            <Field
              label="模型 ID"
              value={manualId}
              required
              maxLength={120}
              onChange={(e) => setManualId(e.target.value)}
            />
            <Button className="primary" disabled={busy}>
              登记候选模型
            </Button>
          </form>
        </Drawer>
        <Drawer
          title={`${advanced?.modelId ?? ""} · 能力设置`}
          open={!!advanced}
          size={560}
          footer={
            <div className="model-capability-footer">
              <Button
                type="button"
                disabled={busy || !advanced}
                onClick={() => {
                  if (!advanced) return;
                  const next = {
                    ...advanced,
                    ...recommendedModelCapabilities(
                      advanced.modelId,
                      advanced.kind,
                    ),
                  };
                  setAdvanced(next);
                  setSizes(next.image?.sizes.join(",") ?? "");
                  setError("");
                }}
              >
                恢复默认
              </Button>
              <Button
                className="primary"
                type="submit"
                form="model-capability-editor"
                disabled={busy}
              >
                应用到待发布配置
              </Button>
            </div>
          }
          onClose={() => setAdvanced(null)}
          destroyOnHidden
        >
          {error && <Notice error>{error}</Notice>}
          {advanced && (
            <form
              id="model-capability-editor"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const value = poolEntryInput.parse({
                    ...advanced,
                    ...(advanced.image
                      ? {
                          image: {
                            ...advanced.image,
                            sizes: sizes
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        }
                      : {}),
                  });
                  if (
                    value.image &&
                    !imageDeclarationWithinKnownLimits(value.image)
                  )
                    throw new Error("KNOWN_MODEL_LIMIT");
                  editEntry(value.id, value);
                  setAdvanced(null);
                } catch {
                  setError(
                    "请检查模型能力：尺寸使用1024x1024格式，质量/格式至少一项，上限不得超过已校准的模型能力。",
                  );
                }
              }}
            >
              {conversationModelKnowledge(advanced.modelId) ? (
                <p className="hint">
                  官方资料支持参考图理解（2026-10-30）。恢复默认会使用系统推荐预算。
                  <a
                    href={conversationModelKnowledge(advanced.modelId)!.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    能力依据
                  </a>
                </p>
              ) : imageModelKnowledge(advanced.modelId) ? (
                <p className="hint">
                  已校准官方文档（2026-10-30）：PNG / JPEG /
                  WebP；边长不超过3840，像素655360—8294400，比例不超过3:1。
                  <a
                    href={imageModelKnowledge(advanced.modelId)!.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    能力依据
                  </a>
                </p>
              ) : (
                <p className="hint">
                  尚无独立能力记录，按服务商文档声明；未经文档或实测确认的能力不要开放。
                </p>
              )}
              {advanced.conversation && (
                <>
                  <Checkbox
                    checked={advanced.conversation.supportsImages}
                    onChange={(e) =>
                      setAdvanced({
                        ...advanced,
                        conversation: {
                          ...advanced.conversation!,
                          supportsImages: e.target.checked,
                        },
                      })
                    }
                  >
                    支持参考图理解
                  </Checkbox>
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: "advanced",
                        label: "高级设置",
                        children: (
                          <div className="model-conversation-advanced">
                            {" "}
                            <ChoiceField
                              label="结构化输出方式"
                              value={advanced.conversation.responseMode}
                              onValueChange={(v) =>
                                setAdvanced({
                                  ...advanced,
                                  conversation: {
                                    ...advanced.conversation!,
                                    responseMode: v as "text" | "json_object",
                                  },
                                })
                              }
                              options={[
                                { value: "json_object", label: "JSON 模式" },
                                { value: "text", label: "文本输出后校验" },
                              ]}
                            />
                            {(
                              ["maxOutputTokens", "maxInputCharacters"] as const
                            ).map((key) => (
                              <Field
                                key={key}
                                label={
                                  key === "maxOutputTokens"
                                    ? "单次规划总输出 token 预算"
                                    : "单次规划输入字符上限"
                                }
                                type="number"
                                min={key === "maxOutputTokens" ? 256 : 1000}
                                max={key === "maxOutputTokens" ? 8192 : 64000}
                                value={advanced.conversation![key]}
                                onChange={(e) =>
                                  setAdvanced({
                                    ...advanced,
                                    conversation: {
                                      ...advanced.conversation!,
                                      [key]: Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            ))}
                          </div>
                        ),
                      },
                    ]}
                  />
                </>
              )}
              {advanced.image && (
                <>
                  <Checkbox
                    checked={advanced.image.generation}
                    onChange={(e) =>
                      setAdvanced({
                        ...advanced,
                        image: {
                          ...advanced.image!,
                          generation: e.target.checked,
                        },
                      })
                    }
                  >
                    支持无参考图生成
                  </Checkbox>
                  <Checkbox
                    checked={advanced.image.editing}
                    onChange={(e) =>
                      setAdvanced({
                        ...advanced,
                        image: {
                          ...advanced.image!,
                          editing: e.target.checked,
                          maxReferences: e.target.checked
                            ? Math.max(1, advanced.image!.maxReferences)
                            : 0,
                        },
                      })
                    }
                  >
                    支持参考图编辑
                  </Checkbox>
                  <div className="parameter-grid">
                    {(["maxEdge", "maxPixels", "maxReferences"] as const).map(
                      (key) => (
                        <Field
                          key={key}
                          label={
                            {
                              maxEdge: "模型最大边长",
                              maxPixels: "模型最大像素数",
                              maxReferences: "最多参考图",
                            }[key]
                          }
                          type="number"
                          min={
                            key === "maxReferences"
                              ? 0
                              : key === "maxEdge"
                                ? 256
                                : 65536
                          }
                          max={
                            key === "maxReferences"
                              ? 4
                              : key === "maxEdge"
                                ? (imageModelKnowledge(advanced.modelId)
                                    ?.maxEdge ?? 8192)
                                : (imageModelKnowledge(advanced.modelId)
                                    ?.maxPixels ?? 32000000)
                          }
                          value={advanced.image![key]}
                          onChange={(e) =>
                            setAdvanced({
                              ...advanced,
                              image: {
                                ...advanced.image!,
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      ),
                    )}
                  </div>
                  <Field
                    label="限定尺寸（英文逗号分隔，留空按上限校验）"
                    value={sizes}
                    onChange={(e) => setSizes(e.target.value)}
                  />
                  <label className="field">
                    <span>支持质量</span>
                    <Select
                      aria-label="支持质量"
                      mode="multiple"
                      value={advanced.image.qualities}
                      options={["low", "medium", "high"].map((value) => ({
                        value,
                        label: value,
                      }))}
                      onChange={(v) =>
                        setAdvanced({
                          ...advanced,
                          image: { ...advanced.image!, qualities: v },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>支持格式</span>
                    <Select
                      aria-label="支持格式"
                      mode="multiple"
                      value={advanced.image.formats}
                      options={["png", "jpeg", "webp"].map((value) => ({
                        value,
                        label: value,
                      }))}
                      onChange={(v) =>
                        setAdvanced({
                          ...advanced,
                          image: { ...advanced.image!, formats: v },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </form>
          )}
        </Drawer>
      </div>
    </ControlScope>
  );
}
