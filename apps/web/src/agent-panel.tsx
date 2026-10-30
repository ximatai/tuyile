import { ImageControls, ReferenceAttachments } from "./image-controls";
import {
  initialSettings,
  selectedCapability,
  settingsIssues,
  type ImageSettings,
} from "./image-settings";
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
  useConfirm,
} from "@tuyile/ui";
import { HelpPopover, Excerpt } from "./interface-help";
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
    [settings, setSettings] = useState<ImageSettings>({
      modelKey: "",
      width: 1024,
      height: 1024,
      quality: "medium",
      format: "png",
      count: 1,
    }),
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
    setConversationModel(
      (old) =>
        old || options.find((e) => e.isDefault)?.id || options[0]?.id || "",
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
  const initialized = useRef(false);
  useEffect(() => {
    if (usage?.models.length && !initialized.current) {
      initialized.current = true;
      setSettings(initialSettings(usage));
    }
  }, [usage]);
  const model = settings.modelKey;
  const issues = usage
    ? settingsIssues(usage, settings, references.length)
    : [];
  const conversationUnavailable =
    !!conversationModel &&
    !!modelPools.data &&
    !modelPools.data.conversation.some((m) => m.id === conversationModel);
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
    if (!pending && (!usage || issues.length)) {
      setError(issues.join(" ") || "请先配置图片模型。");
      return;
    }
    if (
      !pending &&
      conversationModel &&
      modelPools.data &&
      !modelPools.data.conversation.some((m) => m.id === conversationModel)
    ) {
      setError("原对话模型已不可用，请重新选择。");
      return;
    }
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
      width: settings.width,
      height: settings.height,
      quality: settings.quality,
      format: settings.format,
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
            usage={usage}
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
      {!pending && issues.length > 0 && (
        <Notice error>{issues.join(" ")}</Notice>
      )}
      {!pending && conversationUnavailable && (
        <Notice error>原对话模型已不可用，请重新选择或联系管理员。</Notice>
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
                        {(!!modelPools.data?.conversation.length ||
                          conversationModel) && (
                          <ChoiceField
                            label="对话模型"
                            value={conversationModel}
                            onValueChange={setConversationModel}
                            options={[
                              ...(conversationUnavailable
                                ? [
                                    {
                                      value: conversationModel,
                                      label: "原对话模型（已不可用）",
                                      disabled: true,
                                    },
                                  ]
                                : []),
                              ...(modelPools.data?.conversation ?? []).map(
                                (m) => ({
                                  value: m.id,
                                  label: `${m.modelId} · ${m.serviceName}`,
                                }),
                              ),
                            ]}
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
                      </div>
                      <ImageControls
                        usage={usage}
                        value={settings}
                        onChange={setSettings}
                        modelLabel="Agent 图片模型"
                        count={false}
                      />
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
            <div className="agent-references">
              {visible && (
                <ReferenceAttachments
                  agent
                  references={references}
                  onRemove={onRemove}
                  onUpload={onUpload}
                  disabled={busy || !!pending || uploadBusy}
                  maxReferences={
                    usage && selectedCapability(usage, model)?.editing
                      ? selectedCapability(usage, model)!.maxReferences
                      : 0
                  }
                />
              )}
            </div>
          </fieldset>
        </ControlScope>
        <Button
          disabled={
            busy ||
            uploadBusy ||
            !model ||
            (!pending &&
              (!prompt.trim() || issues.length > 0 || conversationUnavailable))
          }
        >
          {pending ? "重试同一规划" : "发送规划需求"}
        </Button>
      </form>
      <div className="agent-confirm-footer">
        <div className="hint heading-with-help">
          规划可用 {planning.data?.available ?? "—"} 次 · 预留{" "}
          {planning.data?.held ?? "—"} 次
          <HelpPopover title="规划与执行规则">
            每次规划在开始调用时计次。计划确认后才生成图片，整单预留图片额度，不足时不自动降低规格；关页和普通退出登录不影响已接受的任务。
          </HelpPopover>
        </div>
        {plan && !plan.confirmed && plan.document.steps.length > 0 ? (
          <>
            <strong>本计划预留 {total} 张图片</strong>
            <span className="hint">可用 {usage?.available ?? "—"} 张</span>
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
        ) : null}
        <span className="hint">
          确认后后台执行，取消可能仍计费；中断不自动续跑。
        </span>
      </div>
    </div>
  );
}
function PlanCard({
  plan,
  visible,
  usage,
  references,
  busy,
  setBusy,
  onCount,
  onRefresh,
}: {
  plan: AgentPlanVersion;
  visible: boolean;
  usage?: ImageUsage;
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
      if (usage && !pending && !confirmation) {
        const issues = document.steps.flatMap((step, index) =>
          settingsIssues(
            usage,
            {
              ...step,
              modelKey: usage.modelOptions
                ? (step.modelSelectionId ?? `historical:${plan.id}`)
                : step.model,
            },
            step.referenceIds.length + (step.usePrevious ? 1 : 0),
          ).map((issue) => `步骤 ${index + 1}：${issue}`),
        );
        if (issues.length) throw new Error(issues.join(" "));
      }
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
      if (usage && !pending && !confirmation) {
        const issues = document.steps.flatMap((step, index) =>
          settingsIssues(
            usage,
            {
              ...step,
              modelKey: usage.modelOptions
                ? (step.modelSelectionId ?? `historical:${plan.id}`)
                : step.model,
            },
            step.referenceIds.length + (step.usePrevious ? 1 : 0),
          ).map((issue) => `步骤 ${index + 1}：${issue}`),
        );
        if (issues.length) throw new Error(issues.join(" "));
      }
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
                <Excerpt rows={3}>{step.prompt}</Excerpt>
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
                <ImageControls
                  usage={usage}
                  labelPrefix={`步骤 ${index + 1}`}
                  modelLabel="模型"
                  value={{
                    ...step,
                    modelKey: usage?.modelOptions
                      ? (step.modelSelectionId ?? `historical:${plan.id}`)
                      : step.model,
                  }}
                  onChange={(value) => {
                    const selected = usage?.modelOptions?.find(
                      (m) => m.id === value.modelKey,
                    );
                    patch(index, {
                      width: value.width,
                      height: value.height,
                      quality: value.quality,
                      format: value.format,
                      count: value.count,
                      model: selected?.modelId ?? value.modelKey,
                      modelSelectionId: selected?.id,
                    });
                  }}
                />
                {!confirmed &&
                  usage &&
                  settingsIssues(
                    usage,
                    {
                      ...step,
                      modelKey: usage.modelOptions
                        ? (step.modelSelectionId ?? `historical:${plan.id}`)
                        : step.model,
                    },
                    step.referenceIds.length + (step.usePrevious ? 1 : 0),
                  ).map((issue) => (
                    <Notice key={issue} error>
                      {issue}
                    </Notice>
                  ))}
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
