import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  agentPlan,
  type AgentPlan,
  type AgentPlanVersion,
  type AgentStep,
  type ImageTask,
  type ImageUsage,
  type PlanningJob,
  type PlanningRequest,
  type PlanningUsage,
  type SkillView,
  type UserModelPools,
  type ModelChoice,
} from "@tuyile/contracts";
import {
  Button,
  Collapse,
  ControlScope,
  Checkbox,
  ChoiceField,
  Field,
  Input,
  Notice,
  Select,
  Upload,
  useConfirm,
} from "@tuyile/ui";
import { ApiError, client } from "./api";
import { useSessionState } from "./session-state";
const states: Record<string, string> = {
  queued: "规划排队中",
  running: "正在规划",
  succeeded: "规划已完成",
  failed: "规划未完成",
  cancelled: "规划已取消",
};
export function AgentPanel({
  visible,
  projectId,
  usage,
  references,
  onRemove,
  onUpload,
  uploadBusy,
  tasks,
}: {
  visible: boolean;
  projectId: string;
  usage?: ImageUsage;
  references: { id: string; name: string }[];
  onRemove: (id: string) => void;
  onUpload: (file: File) => void;
  uploadBusy: boolean;
  tasks: ImageTask[];
}) {
  const state = useSessionState(),
    api = client(state.session.csrfToken);
  const [prompt, setPrompt] = useState(""),
    [skillId, setSkillId] = useState(""),
    [model, setModel] = useState(""),
    [conversationModel, setConversationModel] = useState(""),
    [current, setCurrent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<PlanningRequest | null>(null),
    [total, setTotal] = useState(0);
  const confirmHistory = useConfirm();
  const submitting = useRef(false);
  const jobs = useInfiniteQuery({
    queryKey: state.key("agent-jobs", projectId),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<{ jobs: PlanningJob[] }>(
        `/agent/jobs?projectId=${projectId}&offset=${pageParam}`,
        undefined,
        signal,
      ),
    getNextPageParam: (page, pages) =>
      page.jobs.length === 50 ? pages.length * 50 : undefined,
    refetchInterval: 1500,
  });
  const modelPools = useQuery({
    queryKey: state.key("model-pools"),
    queryFn: ({ signal }) => api<UserModelPools>("/models", undefined, signal),
    refetchInterval: 10000,
  });
  useEffect(() => {
    const options = modelPools.data?.conversation ?? [];
    setConversationModel((old) =>
      options.some((e) => e.id === old)
        ? old
        : (options.find((e) => e.isDefault)?.id ?? options[0]?.id ?? ""),
    );
  }, [modelPools.data]);
  const planning = useQuery({
    queryKey: state.key("planning-usage"),
    queryFn: ({ signal }) =>
      api<PlanningUsage>("/agent/usage", undefined, signal),
    refetchInterval: 1500,
  });
  const skills = useQuery({
    queryKey: state.key("skills"),
    queryFn: ({ signal }) =>
      api<{ skills: SkillView[] }>("/skills", undefined, signal),
  });
  useEffect(() => {
    if (usage)
      setModel((old) =>
        usage.modelOptions
          ? usage.modelOptions.some((e) => e.id === old)
            ? old
            : (usage.modelOptions.find((e) => e.isDefault)?.id ??
              usage.modelOptions[0]?.id ??
              "")
          : usage.models.includes(old)
            ? old
            : (usage.models[0] ?? ""),
      );
  }, [usage]);
  const history = jobs.data?.pages.flatMap((page) => page.jobs) ?? [];
  const selected = history.find((j) => j.id === current) ?? history[0],
    plan = selected?.plans.at(-1);
  async function refresh() {
    await Promise.all([
      state.queries.invalidateQueries({
        queryKey: state.key("agent-jobs", projectId),
      }),
      state.queries.invalidateQueries({
        queryKey: state.key("planning-usage"),
      }),
      state.queries.invalidateQueries({ queryKey: state.key("usage") }),
      state.queries.invalidateQueries({
        queryKey: state.key("tasks", projectId),
      }),
    ]);
  }
  async function request(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || busy) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const input = pending ?? {
      projectId,
      requestKey: crypto.randomUUID(),
      prompt,
      model: usage?.modelOptions?.find((e) => e.id === model)?.modelId ?? model,
      ...(usage?.modelOptions ? { modelSelectionId: model } : {}),
      ...(conversationModel ? { conversationModelId: conversationModel } : {}),
      width: 1024,
      height: 1024,
      quality: "medium" as const,
      format: "png" as const,
      referenceIds: references.map((r) => r.id),
      ...(skillId ? { skillId } : {}),
      ...(plan ? { previousPlanId: plan.id } : {}),
    };
    setPending(input);
    try {
      const job = await api<PlanningJob>("/agent/planning", input);
      setCurrent(job.id);
      setSettingsOpen(false);
      setPending(null);
      setPrompt("");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
        setPending(null);
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function cancel(kind: "jobs" | "plans", id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/agent/${kind}/${id}/cancel`, {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clearHistory() {
    if (
      busy ||
      !(await confirmHistory(
        "清空本项目的规划对话与计划？图片及任务历史保留；活动或待核验任务处理完成后才能清空。",
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/agent/projects/${projectId}/clear`, {});
      setCurrent("");
      setPending(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const active = !!plan?.taskIds.some((id) =>
    tasks.some((t) => t.id === id && ["queued", "running"].includes(t.state)),
  );
  return (
    <div className="agent-panel">
      {history.length > 0 && (
        <Button
          className="agent-clear-history"
          disabled={busy || !!pending}
          onClick={() => void clearHistory()}
        >
          清空规划对话
        </Button>
      )}
      <div className="agent-conversation" aria-label="Agent 对话">
        {!history.length && !jobs.isPending && (
          <div className="agent-intro">
            <h2>先聊想法，再确认创作</h2>
            <p>
              描述目标和风格。Agent 会先给出可修改的计划，确认后才生成图片。
            </p>
          </div>
        )}
        {jobs.hasNextPage && (
          <Button disabled={busy} onClick={() => void jobs.fetchNextPage()}>
            加载更早的对话
          </Button>
        )}
        {[...history].reverse().map((job) => (
          <article
            className={`agent-message ${job.id === selected?.id ? "current" : ""}`}
            key={job.id}
          >
            <p className="agent-user-message">{job.prompt}</p>
            <div className="hint">
              {states[job.state]} · {job.charged ? "已计 1 次规划" : "尚未计用"}
            </div>
            {job.errorCode && (
              <Notice error>
                {new ApiError(job.errorCode).message}（{job.errorCode}）
              </Notice>
            )}
            {job.plans.at(-1) && (
              <>
                <p>{job.plans.at(-1)!.document.message}</p>
                {job.id !== selected?.id && (
                  <Button
                    disabled={busy || !!pending}
                    onClick={() => setCurrent(job.id)}
                  >
                    查看这个计划
                  </Button>
                )}
              </>
            )}
            {["queued", "running"].includes(job.state) && (
              <Button
                disabled={busy}
                onClick={() => void cancel("jobs", job.id)}
              >
                取消规划
              </Button>
            )}
          </article>
        ))}
        {plan && (
          <PlanCard
            key={plan.id}
            plan={plan}
            visible={visible}
            models={usage?.models ?? []}
            modelOptions={usage?.modelOptions}
            references={references}
            busy={busy}
            setBusy={setBusy}
            onCount={setTotal}
            onRefresh={refresh}
          />
        )}
      </div>
      {(error || jobs.error || planning.error || skills.error) && (
        <Notice error>
          {error ||
            jobs.error?.message ||
            planning.error?.message ||
            skills.error?.message}
        </Notice>
      )}
      <form
        className="agent-compose"
        onSubmit={request}
        aria-label="请求 Agent 规划"
      >
        <ControlScope componentDisabled={busy || !!pending || uploadBusy}>
          <fieldset disabled={busy || !!pending || uploadBusy}>
            <Collapse
              size="small"
              activeKey={settingsOpen ? ["settings"] : []}
              onChange={(keys) => setSettingsOpen(keys.includes("settings"))}
              items={[
                {
                  key: "settings",
                  label: `创作设置 · ${skillId ? "已选技能" : "通用创作"} · ${usage?.modelOptions?.find((e) => e.id === model)?.modelId || model || "未配置模型"}`,
                  children: (
                    <>
                      {" "}
                      <div className="agent-options">
                        {!!modelPools.data?.conversation.length && (
                          <ChoiceField
                            label="对话模型"
                            value={conversationModel}
                            onValueChange={setConversationModel}
                            options={modelPools.data.conversation.map((m) => ({
                              value: m.id,
                              label: `${m.modelId} · ${m.serviceName}`,
                            }))}
                          />
                        )}
                        <ChoiceField
                          label="创作技能"
                          value={skillId}
                          onValueChange={setSkillId}
                          options={[
                            { value: "", label: "通用创作" },
                            ...(skills.data?.skills ?? []).map((s) => ({
                              value: s.id,
                              label: `${s.name} v${s.version}`,
                            })),
                          ]}
                        />
                        <ChoiceField
                          label="Agent 图片模型"
                          value={model}
                          onValueChange={setModel}
                          options={
                            usage?.modelOptions?.map((m) => ({
                              value: m.id,
                              label: `${m.modelId} · ${m.serviceName}`,
                            })) ??
                            (usage?.models ?? []).map((m) => ({
                              value: m,
                              label: m,
                            }))
                          }
                        />
                      </div>
                      <div className="agent-references">
                        <Upload
                          accept="image/png,image/jpeg,image/webp"
                          showUploadList={false}
                          beforeUpload={(file) => {
                            onUpload(file);
                            return false;
                          }}
                          disabled={
                            busy || uploadBusy || references.length >= 4
                          }
                        >
                          <Button type="button">添加 Agent 参考图</Button>
                        </Upload>
                        {references.map((r) => (
                          <span className="agent-reference" key={r.id}>
                            <img
                              src={`/api/images/assets/${r.id}/preview`}
                              alt={r.name}
                            />
                            <Button
                              type="button"
                              aria-label={`移除 Agent 参考图 ${r.name}`}
                              onClick={() => onRemove(r.id)}
                            >
                              移除
                            </Button>
                          </span>
                        ))}
                      </div>
                    </>
                  ),
                },
              ]}
            />
            <label className="field">
              <span className="sr-only">告诉 Agent 你的想法</span>
              <Input.TextArea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                maxLength={12000}
                required
                placeholder="例如：为这款产品设计一组简洁的宣传图"
              />
            </label>
          </fieldset>
        </ControlScope>
        <Button
          disabled={
            busy || uploadBusy || !model || (!pending && !prompt.trim())
          }
        >
          {pending ? "重试同一规划" : "发送规划需求"}
        </Button>
      </form>
      <div className="agent-confirm-footer">
        <div className="hint">
          规划：可用 {planning.data?.available ?? "—"} 次 · 预留{" "}
          {planning.data?.held ?? "—"} 次
        </div>
        {plan && !plan.confirmed && plan.document.steps.length > 0 ? (
          <>
            <strong>本计划预留 {total} 张图片</strong>
            <span className="hint">
              当前可用 {usage?.available ?? "—"} 张。额度不足将整单拒绝。
            </span>
            <Button
              className="primary"
              type="submit"
              form={`confirm-${plan.id}`}
              disabled={busy || uploadBusy}
            >
              {busy ? "正在处理…" : "确认执行"}
            </Button>
          </>
        ) : plan?.confirmed ? (
          <>
            <strong>{active ? "计划正在后台执行" : "计划已确认"}</strong>
            <Button
              disabled={busy || !active}
              onClick={() => void cancel("plans", plan.id)}
            >
              停止后续执行
            </Button>
          </>
        ) : (
          <span className="hint">收到可执行计划后，在这里确认。</span>
        )}
        <span className="hint">
          确认后关页仍在后台执行；取消可能仍计费。后台中断后不自动续跑。
        </span>
      </div>
    </div>
  );
}
function PlanCard({
  plan,
  visible,
  models,
  modelOptions,
  references,
  busy,
  setBusy,
  onCount,
  onRefresh,
}: {
  plan: AgentPlanVersion;
  visible: boolean;
  models: string[];
  modelOptions?: ModelChoice[];
  references: { id: string; name: string }[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  onCount: (v: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const state = useSessionState(),
    api = client(state.session.csrfToken);
  const [document, setDocument] = useState<AgentPlan>(() =>
      structuredClone(plan.document),
    ),
    [error, setError] = useState(""),
    [pending, setPending] = useState<{
      requestKey: string;
      document: AgentPlan;
    } | null>(null),
    [confirmation, setConfirmation] = useState<string | null>(null),
    [locallyConfirmed, setConfirmed] = useState(plan.confirmed);
  const confirmed = locallyConfirmed || plan.confirmed;
  const [editing, setEditing] = useState(false);
  const active = useRef(false);
  const card = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const element = card.current;
    const conversation = element?.closest<HTMLElement>(".agent-conversation");
    if (!visible || editing || !element || !conversation) return;
    let frame = 0;
    const place = () => {
      const box = element.getBoundingClientRect();
      const viewport = conversation.getBoundingClientRect();
      // Scroll only the conversation. A browser-wide scrollIntoView can move
      // the whole workspace; a desktop resize must also reveal the latest card.
      const delta =
        box.height > viewport.height - 8
          ? box.top - viewport.top
          : box.bottom > viewport.bottom - 4
            ? box.bottom - viewport.bottom + 4
            : box.top < viewport.top
              ? box.top - viewport.top
              : 0;
      if (Math.abs(delta) > 1) conversation.scrollTop += delta;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(conversation);
    observer.observe(element);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [plan.id, editing, visible]);
  useEffect(() => {
    // Another device can confirm this immutable version while local edits are unsaved.
    if (plan.confirmed) setDocument(structuredClone(plan.document));
  }, [plan.confirmed, plan.document]);
  useEffect(
    () => onCount(document.steps.reduce((n, s) => n + s.count, 0)),
    [document, onCount],
  );
  function patch(index: number, change: Partial<AgentStep>) {
    setDocument((old) => ({
      ...old,
      steps: old.steps.map((step, i) => {
        if (i !== index) return step;
        const next = { ...step, ...change };
        if (
          next.tool.version === 1 &&
          ["image.generate", "image.edit"].includes(next.tool.id)
        )
          next.tool = {
            id:
              next.usePrevious || next.referenceIds.length
                ? "image.edit"
                : "image.generate",
            version: 1,
          };
        return next;
      }),
    }));
  }
  async function saveDraft() {
    if (active.current || busy) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      if (!agentPlan.safeParse(document).success)
        throw new Error("请检查计划步骤、图片总数及参考图要求。");
      const input = pending ?? { requestKey: crypto.randomUUID(), document };
      setPending(input);
      try {
        await api<AgentPlanVersion>(
          `/agent/jobs/${plan.jobId}/revisions`,
          input,
        );
      } catch (e) {
        if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
          setPending(null);
        throw e;
      }
      setPending(null);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (active.current || busy) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      if (!agentPlan.safeParse(document).success)
        throw new Error(
          "请检查计划：首步不能引用上一步，总数最多 16 张，参考图最多 4 张。",
        );
      let id = confirmation ?? plan.id;
      if (
        !confirmation &&
        (pending || JSON.stringify(document) !== JSON.stringify(plan.document))
      ) {
        const input = pending ?? { requestKey: crypto.randomUUID(), document };
        setPending(input);
        let saved: AgentPlanVersion;
        try {
          saved = await api<AgentPlanVersion>(
            `/agent/jobs/${plan.jobId}/revisions`,
            input,
          );
        } catch (e) {
          if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
            setPending(null);
          throw e;
        }
        id = saved.id;
        setPending(null);
      }
      setConfirmation(id);
      await api(`/agent/plans/${id}/confirm`, {});
      setConfirmed(true);
      await onRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
        setConfirmation(null);
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      ref={card}
      id={`confirm-${plan.id}`}
      className="agent-plan-form"
      onSubmit={confirm}
      aria-label="编辑 Agent 计划"
    >
      <div className="agent-plan-title">
        <strong>创作计划 · v{plan.version}</strong>
        <span className={`plan-status ${confirmed ? "confirmed" : ""}`}>
          {confirmed ? "已确认" : "待确认"}
        </span>
      </div>
      <Button
        type="button"
        className="plan-edit-toggle"
        disabled={busy || (!confirmed && (!!pending || !!confirmation))}
        onClick={() => setEditing((value) => !value)}
      >
        {editing ? "查看计划摘要" : confirmed ? "查看完整计划" : "修改计划"}
      </Button>
      {!editing && (
        <ol className="agent-plan-summary" aria-label="计划步骤摘要">
          {document.steps.map((step, index) => (
            <li key={index}>
              <span className="plan-step-number">{index + 1}</span>
              <div className="plan-step-content">
                <strong>
                  {step.title}
                  <span>{step.count} 张</span>
                </strong>
                <p>{step.prompt}</p>
                <small>
                  {step.width} × {step.height} · {step.model} · {step.quality} ·{" "}
                  {step.format.toUpperCase()}
                </small>
                {step.usePrevious && (
                  <small className="plan-dependency">
                    使用上一步第一张结果
                  </small>
                )}
                {!!step.referenceIds.length && (
                  <div className="plan-reference-previews">
                    {step.referenceIds.map((id) => (
                      <img
                        key={id}
                        src={`/api/images/assets/${id}/preview`}
                        alt={`步骤 ${index + 1} 参考图`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {error && !confirmed && <Notice error>{error}</Notice>}
      {(pending || confirmation) && !confirmed && (
        <p className="hint">
          正在确认这份版本；结果不明时再次点击确认可找回原提交。
        </p>
      )}
      <div hidden={!editing}>
        <ControlScope
          componentDisabled={
            !editing || busy || confirmed || !!pending || !!confirmation
          }
        >
          <fieldset
            disabled={
              !editing || busy || confirmed || !!pending || !!confirmation
            }
          >
            {document.steps.map((step, index) => (
              <section className="agent-step" key={index}>
                <Field
                  label={`步骤 ${index + 1} 名称`}
                  value={step.title}
                  maxLength={100}
                  required
                  onChange={(e) => patch(index, { title: e.target.value })}
                />
                <label className="field">
                  <span>步骤 {index + 1} 提示词</span>
                  <Input.TextArea
                    aria-label={`步骤 ${index + 1} 提示词`}
                    value={step.prompt}
                    rows={3}
                    maxLength={12000}
                    required
                    onChange={(e) => patch(index, { prompt: e.target.value })}
                  />
                </label>
                <div className="parameter-grid">
                  <Field
                    label={`步骤 ${index + 1} 张数`}
                    type="number"
                    min={1}
                    max={16}
                    value={step.count}
                    required
                    onChange={(e) =>
                      patch(index, { count: Number(e.target.value) })
                    }
                  />
                  <ChoiceField
                    label={`步骤 ${index + 1} 模型`}
                    value={step.modelSelectionId ?? step.model}
                    onValueChange={(value) => {
                      const selected = modelOptions?.find(
                        (e) => e.id === value,
                      );
                      patch(index, {
                        model: selected?.modelId ?? value,
                        modelSelectionId: selected?.id,
                      });
                    }}
                    options={
                      modelOptions
                        ? [
                            ...modelOptions.map((e) => ({
                              value: e.id,
                              label: `${e.modelId} · ${e.serviceName}`,
                            })),
                            ...(!modelOptions.some(
                              (e) => e.id === step.modelSelectionId,
                            )
                              ? [
                                  {
                                    value: step.modelSelectionId ?? step.model,
                                    label: `${step.model}（原选择）`,
                                  },
                                ]
                              : []),
                          ]
                        : [...new Set([...models, step.model])].map((m) => ({
                            value: m,
                            label: m,
                          }))
                    }
                  />
                  <Field
                    label={`步骤 ${index + 1} 宽度`}
                    type="number"
                    min={256}
                    max={8192}
                    step={16}
                    value={step.width}
                    required
                    onChange={(e) =>
                      patch(index, { width: Number(e.target.value) })
                    }
                  />
                  <Field
                    label={`步骤 ${index + 1} 高度`}
                    type="number"
                    min={256}
                    max={8192}
                    step={16}
                    value={step.height}
                    required
                    onChange={(e) =>
                      patch(index, { height: Number(e.target.value) })
                    }
                  />
                  <ChoiceField
                    label={`步骤 ${index + 1} 质量`}
                    value={step.quality}
                    onValueChange={(quality) =>
                      patch(index, { quality: quality as AgentStep["quality"] })
                    }
                    options={[
                      { value: "low", label: "低" },
                      { value: "medium", label: "中" },
                      { value: "high", label: "高" },
                    ]}
                  />
                  <ChoiceField
                    label={`步骤 ${index + 1} 格式`}
                    value={step.format}
                    onValueChange={(format) =>
                      patch(index, { format: format as AgentStep["format"] })
                    }
                    options={[
                      { value: "png", label: "PNG" },
                      { value: "jpeg", label: "JPEG" },
                      { value: "webp", label: "WebP" },
                    ]}
                  />
                </div>
                <label className="field">
                  <span>步骤 {index + 1} 参考图</span>
                  <Select
                    mode="multiple"
                    value={step.referenceIds}
                    onChange={(referenceIds) => patch(index, { referenceIds })}
                    options={[
                      ...new Map(
                        [
                          ...references,
                          ...step.referenceIds.map((id) => ({
                            id,
                            name: "计划参考图",
                          })),
                        ].map((r) => [r.id, { value: r.id, label: r.name }]),
                      ).values(),
                    ]}
                  />
                </label>
                {index > 0 && (
                  <Checkbox
                    checked={step.usePrevious}
                    onChange={(e) =>
                      patch(index, { usePrevious: e.target.checked })
                    }
                  >
                    使用上一步第一张图片
                  </Checkbox>
                )}
                <p className="hint">
                  工具：{step.tool.id} v{step.tool.version}
                </p>
                <Button
                  type="button"
                  onClick={() =>
                    setDocument((old) => ({
                      ...old,
                      steps: old.steps
                        .filter((_, i) => i !== index)
                        .map((s, i) =>
                          i === 0
                            ? {
                                ...s,
                                usePrevious: false,
                                tool:
                                  s.tool.version === 1 &&
                                  ["image.generate", "image.edit"].includes(
                                    s.tool.id,
                                  )
                                    ? {
                                        id: s.referenceIds.length
                                          ? "image.edit"
                                          : "image.generate",
                                        version: 1,
                                      }
                                    : s.tool,
                              }
                            : s,
                        ),
                    }))
                  }
                >
                  移除步骤
                </Button>
              </section>
            ))}
            {document.steps.length > 0 && document.steps.length < 16 && (
              <Button
                type="button"
                onClick={() =>
                  setDocument((old) => ({
                    ...old,
                    steps: [
                      ...old.steps,
                      {
                        ...old.steps.at(-1)!,
                        title: `步骤 ${old.steps.length + 1}`,
                        referenceIds: [...old.steps.at(-1)!.referenceIds],
                        usePrevious: false,
                        tool:
                          old.steps.at(-1)!.tool.version === 1 &&
                          ["image.generate", "image.edit"].includes(
                            old.steps.at(-1)!.tool.id,
                          )
                            ? {
                                id: old.steps.at(-1)!.referenceIds.length
                                  ? "image.edit"
                                  : "image.generate",
                                version: 1,
                              }
                            : old.steps.at(-1)!.tool,
                      },
                    ],
                  }))
                }
              >
                添加步骤
              </Button>
            )}
          </fieldset>
        </ControlScope>
        {editing && !confirmed && !confirmation && (
          <Button
            type="button"
            disabled={
              busy ||
              (!pending &&
                JSON.stringify(document) === JSON.stringify(plan.document))
            }
            onClick={() => void saveDraft()}
          >
            {pending ? "重试保存本次修改" : "保存计划修改"}
          </Button>
        )}
      </div>
    </form>
  );
}
