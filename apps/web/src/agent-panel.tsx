import { modelDisplayName } from "./model-presentation";
import { ChevronDown, Settings2, Sparkles } from "lucide-react";
import { useDraftValue } from "./project-draft";
import { composeCreativePrompt } from "@tuyile/contracts";
import { PromptComposer } from "./prompt-composer";
import { ImageControls, ReferenceAttachments } from "./image-controls";
import {
  initialSettings,
  selectedCapability,
  settingsIssues,
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
  Popover,
  Select,
  Tooltip,
  useConfirm,
} from "@tuyile/ui";
import { HelpPopover } from "./interface-help";
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
  selectedCanvas,
  onUseSelected,
  onRemove,
  onUpload,
  uploadBusy,
  tasks,
}: {
  visible: boolean;
  projectId: string;
  usage?: ImageUsage;
  references: { id: string; name: string }[];
  selectedCanvas: { id: string; name: string }[];
  onUseSelected: () => void;
  onRemove: (id: string) => void;
  onUpload: (file: File) => void;
  uploadBusy: boolean;
  tasks: ImageTask[];
}) {
  const state = useSessionState(),
    api = client(state.session.csrfToken);
  const [prompt, setPrompt] = useDraftValue("agent", "prompt"),
    [style, setStyle] = useDraftValue("agent", "style"),
    [skillId, setSkillId] = useDraftValue("agent", "skillId"),
    [settings, setSettings] = useDraftValue("agent", "settings"),
    [conversationModel, setConversationModel] = useDraftValue(
      "agent",
      "conversationModel",
    ),
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
      setSettings((old) => (old.modelKey ? old : initialSettings(usage)));
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
  const [planDirty, setPlanDirty] = useState(false);
  const history = jobs.data?.pages.flatMap((page) => page.jobs) ?? [];
  const awaitingReply = history.some((job) =>
    ["queued", "running"].includes(job.state),
  );
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
    if (
      submitting.current ||
      busy ||
      (!pending && (awaitingReply || jobs.isPending || !!jobs.error))
    )
      return;
    if (planDirty) {
      setError("请先保存方案修改，再继续沟通。");
      return;
    }
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
      ...(style ? { style } : {}),
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
  const hasProposal = !!plan?.document.steps.length;
  const composeForm = useRef<HTMLFormElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  useEffect(() => {
    setComposeOpen(!hasProposal);
    setPlanDirty(false);
  }, [plan?.id, hasProposal]);
  useEffect(() => {
    if (composeOpen && visible && plan)
      composeForm.current?.querySelector("textarea")?.focus();
  }, [composeOpen, visible, plan?.id]);
  const settingsTrigger = useRef<React.ComponentRef<typeof Button>>(null);
  useEffect(() => {
    if (!visible || (hasProposal && !composeOpen)) setSettingsOpen(false);
  }, [visible, hasProposal, composeOpen]);
  const active = !!plan?.taskIds.some((id) =>
    tasks.some((t) => t.id === id && ["queued", "running"].includes(t.state)),
  );
  const requestLabel = pending
    ? "重试同一规划"
    : awaitingReply
      ? "正在规划…"
      : plan
        ? hasProposal
          ? "更新方案"
          : "发送回答"
        : "生成计划";
  return (
    <div
      className={`agent-panel ${!history.length ? "agent-panel-empty" : ""}`}
    >
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
            <div className="agent-intro-icon" aria-hidden="true">
              <Sparkles size={26} />
            </div>
            <h2>先聊想法，再确认创作</h2>
            <p>确认计划后才会生成图片</p>
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
            {job.style && (
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: "style",
                    label: `风格 · ${job.style.name}`,
                    children: job.style.text,
                  },
                ]}
              />
            )}
            {job.state !== "succeeded" && (
              <div className="hint">{states[job.state]}</div>
            )}
            {job.errorCode && (
              <Notice error>{new ApiError(job.errorCode).message}</Notice>
            )}
            {job.plans.at(-1) && (
              <>
                {(job.id !== selected?.id ||
                  !job.plans.at(-1)!.document.steps.length) && (
                  <p className="agent-reply">
                    {job.plans.at(-1)!.document.message}
                  </p>
                )}
                {job.id !== selected?.id &&
                  !!job.plans.at(-1)!.document.steps.length && (
                    <Button
                      disabled={busy || !!pending || planDirty}
                      onClick={() => setCurrent(job.id)}
                    >
                      查看方案
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
        {hasProposal && plan && (
          <PlanCard
            key={plan.id}
            plan={plan}
            visible={visible}
            usage={usage}
            references={references}
            busy={busy}
            setBusy={setBusy}
            onDirtyChange={setPlanDirty}
            onDiscuss={() => {
              if (!planDirty) setComposeOpen(true);
            }}
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
      {hasProposal && (
        <Button
          type="button"
          className="agent-followup-trigger"
          disabled={planDirty || busy || !!pending}
          title={planDirty ? "先保存方案修改，再继续沟通" : undefined}
          aria-expanded={composeOpen}
          onClick={() => setComposeOpen(!composeOpen)}
        >
          继续聊想法
          <ChevronDown size={15} aria-hidden="true" />
        </Button>
      )}
      <form
        ref={composeForm}
        hidden={hasProposal && !composeOpen}
        className="agent-compose"
        onSubmit={request}
        aria-label="请求 Agent 规划"
      >
        <ControlScope componentDisabled={busy || !!pending || uploadBusy}>
          <fieldset disabled={busy || !!pending || uploadBusy}>
            <PromptComposer
              value={prompt}
              onChange={setPrompt}
              style={style}
              onStyleChange={setStyle}
              label="告诉 Agent 你的想法"
              rows={4}
              compact
              visible={visible}
            />
            <div className="agent-references">
              {visible && (
                <ReferenceAttachments
                  agent
                  references={references}
                  selected={selectedCanvas}
                  onUseSelected={onUseSelected}
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
            <div className="agent-compose-toolbar">
              <Popover
                trigger="click"
                placement="topRight"
                title="创作设置"
                classNames={{ root: "creation-popover agent-settings-popover" }}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                content={
                  <div
                    className="agent-settings-content"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setSettingsOpen(false);
                        settingsTrigger.current?.focus();
                      }
                    }}
                  >
                    <div className="agent-options">
                      {(!!modelPools.data?.conversation.length ||
                        conversationModel) && (
                        <ChoiceField
                          label="对话模型"
                          labelRender={(option) => {
                            const model = modelPools.data?.conversation.find(
                              (m) => m.id === option.value,
                            );
                            return model
                              ? modelDisplayName(model.modelId)
                              : option.label;
                          }}
                          popupMatchSelectWidth={280}
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
                                title: "",
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
                      disabled={busy || !!pending || uploadBusy}
                      usage={usage}
                      value={settings}
                      onChange={setSettings}
                      compact
                      count={false}
                    />
                  </div>
                }
              >
                <Button
                  type="button"
                  className="agent-settings-trigger"
                  ref={settingsTrigger}
                  aria-expanded={settingsOpen}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setSettingsOpen(false);
                    }
                  }}
                >
                  <Settings2 size={15} aria-hidden="true" />
                  创作设置
                </Button>
              </Popover>
              <div className="agent-planning-quota hint">
                <span>
                  可规划 {planning.data?.available ?? "—"} 次
                  {planning.data?.held
                    ? ` · 待结算 ${planning.data.held} 次`
                    : ""}
                </span>
                <HelpPopover
                  title="规划与执行规则"
                  visible={visible && (!hasProposal || composeOpen)}
                >
                  规划开始调用时计次，确认计划后才生成图片并预留额度。额度不足时不降低规格。生图任务是后台执行，关闭页面不影响任务执行和费用核算。取消可能计费，后台中断不自动续跑。
                </HelpPopover>
              </div>
            </div>
          </fieldset>
        </ControlScope>
        <Button
          className="primary agent-plan-submit"
          aria-label={requestLabel}
          title={planDirty ? "先保存方案修改，再继续沟通" : undefined}
          loading={busy}
          disabled={
            planDirty ||
            busy ||
            uploadBusy ||
            !model ||
            (!pending &&
              (awaitingReply ||
                jobs.isPending ||
                !!jobs.error ||
                !prompt.trim() ||
                issues.length > 0 ||
                conversationUnavailable ||
                (style && !style.text.trim()) ||
                composeCreativePrompt({ prompt, style }).length > 12000))
          }
        >
          {requestLabel}
        </Button>
      </form>
      {hasProposal && plan && (
        <div className="agent-confirm-footer">
          <div className="agent-confirm-summary">
            <strong>
              {plan.confirmed
                ? active
                  ? "计划正在后台执行"
                  : "计划已确认"
                : `本计划预留 ${total} 张图片`}
            </strong>
            <HelpPopover title="执行说明" visible={visible && hasProposal}>
              生图任务是后台执行，关闭页面不影响任务执行和费用核算。取消可能计费；后台中断不自动续跑，已保存图片保留。
            </HelpPopover>
          </div>
          {!plan.confirmed && plan.document.steps.length > 0 ? (
            <>
              <span className="hint">
                {usage?.available === null
                  ? "图片不限额"
                  : `可用 ${usage?.available ?? "—"} 张`}
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
          ) : plan.confirmed ? (
            <>
              <Button
                disabled={busy || !active}
                onClick={() => void cancel("plans", plan.id)}
              >
                停止后续执行
              </Button>
            </>
          ) : null}
        </div>
      )}
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
  onDiscuss,
  onDirtyChange,
  onRefresh,
}: {
  plan: AgentPlanVersion;
  visible: boolean;
  usage?: ImageUsage;
  references: { id: string; name: string }[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  onCount: (v: number) => void;
  onDiscuss: () => void;
  onDirtyChange: (dirty: boolean) => void;
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
    if (locallyConfirmed || plan.confirmed || busy || pending || confirmation)
      return;
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
      setConfirmation(null);
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
  function removeStep(index: number) {
    setDocument((old) => ({
      ...old,
      steps: old.steps
        .filter((_, i) => i !== index)
        .map((step, i) =>
          i === 0
            ? {
                ...step,
                usePrevious: false,
                tool:
                  step.tool.version === 1 &&
                  ["image.generate", "image.edit"].includes(step.tool.id)
                    ? {
                        id: step.referenceIds.length
                          ? "image.edit"
                          : "image.generate",
                        version: 1,
                      }
                    : step.tool,
              }
            : step,
        ),
    }));
  }
  function addStep() {
    setDocument((old) => {
      const last = old.steps.at(-1)!;
      return {
        ...old,
        steps: [
          ...old.steps,
          {
            ...last,
            title: `步骤 ${old.steps.length + 1}`,
            referenceIds: [...last.referenceIds],
            usePrevious: false,
            tool:
              last.tool.version === 1 &&
              ["image.generate", "image.edit"].includes(last.tool.id)
                ? {
                    id: last.referenceIds.length
                      ? "image.edit"
                      : "image.generate",
                    version: 1,
                  }
                : last.tool,
          },
        ],
      };
    });
  }
  const locked = busy || (!confirmed && (!!pending || !!confirmation));
  const dirty = JSON.stringify(document) !== JSON.stringify(plan.document);
  const discardConfirm = useConfirm();
  const leaveConfirm = useRef(discardConfirm);
  leaveConfirm.current = discardConfirm;
  const leaveState = useRef({ dirty: false, waiting: false, confirmed });
  leaveState.current = {
    dirty: !confirmed && dirty,
    waiting: !confirmed && !!(pending || confirmation),
    confirmed,
  };
  useEffect(
    () =>
      state.registerNavigationGuard({
        isDirty: () =>
          leaveState.current.dirty ||
          leaveState.current.waiting ||
          (!leaveState.current.confirmed && active.current),
        canLeave: async () => {
          if (
            leaveState.current.waiting ||
            (!leaveState.current.confirmed && active.current)
          ) {
            setError("请先确认本次保存或执行结果，再离开页面。");
            return false;
          }
          return (
            !leaveState.current.dirty ||
            leaveConfirm.current("方案修改尚未保存，放弃修改并离开页面？")
          );
        },
      }),
    [state],
  );

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  return (
    <form
      ref={card}
      id={`confirm-${plan.id}`}
      className="agent-plan-form"
      onSubmit={confirm}
      aria-label="编辑 Agent 计划"
    >
      <div className="agent-plan-title">
        <strong>
          {document.steps.length === 1 ? document.steps[0]!.title : "创作方案"}
        </strong>
        <span className={`plan-status ${confirmed ? "confirmed" : ""}`}>
          {confirmed ? "已确认" : "待确认"}
        </span>
      </div>
      <p className="agent-proposal-description">{document.message}</p>
      <div className="agent-proposal-actions">
        {!confirmed && (
          <Tooltip title={dirty ? "先保存修改，再继续沟通" : undefined}>
            <span>
              <Button
                type="button"
                disabled={locked || dirty}
                onClick={onDiscuss}
              >
                调整方案
              </Button>
            </span>
          </Tooltip>
        )}
        <Button
          type="button"
          className="plan-edit-toggle"
          disabled={locked}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? "返回方案" : confirmed ? "查看提示词" : "编辑提示词"}
        </Button>
      </div>
      <ControlScope componentDisabled={locked || confirmed}>
        <fieldset>
          <ol className="agent-plan-summary" aria-label="计划步骤摘要">
            {document.steps.map((step, index) => (
              <li key={index}>
                {document.steps.length > 1 && (
                  <span className="plan-step-number">{index + 1}</span>
                )}
                <div className="plan-step-content">
                  {editing ? (
                    <>
                      <Field
                        label={`步骤 ${index + 1} 名称`}
                        value={step.title}
                        maxLength={100}
                        required
                        onChange={(event) =>
                          patch(index, { title: event.target.value })
                        }
                      />
                      <label className="field">
                        <span>步骤 {index + 1} 提示词</span>
                        <Input.TextArea
                          aria-label={`步骤 ${index + 1} 提示词`}
                          value={step.prompt}
                          rows={4}
                          maxLength={12000}
                          required
                          onChange={(event) =>
                            patch(index, { prompt: event.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : document.steps.length > 1 ? (
                    <strong>{step.title}</strong>
                  ) : null}
                  <div className="plan-step-controls">
                    <small className="plan-deliverable">
                      {step.count} 张 ·{" "}
                      {step.width === step.height
                        ? "方形"
                        : step.width > step.height
                          ? "横版"
                          : "竖版"}{" "}
                      ·{" "}
                      {
                        { low: "快速草稿", medium: "标准", high: "高质量" }[
                          step.quality
                        ]
                      }
                    </small>
                    <PlanStepParameters
                      index={index}
                      visible={visible}
                      disabled={locked}
                    >
                      <ImageControls
                        disabled={locked || confirmed}
                        usage={usage}
                        labelPrefix={`步骤 ${index + 1}`}
                        modelLabel="图片模型"
                        compact
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
                              ? (step.modelSelectionId ??
                                `historical:${plan.id}`)
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
                          onChange={(referenceIds) =>
                            patch(index, { referenceIds })
                          }
                          options={[
                            ...new Map(
                              [
                                ...references,
                                ...step.referenceIds.map((id) => ({
                                  id,
                                  name: "计划参考图",
                                })),
                              ].map((r) => [
                                r.id,
                                { value: r.id, label: r.name },
                              ]),
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
                    </PlanStepParameters>
                  </div>
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
                  {editing && !confirmed && document.steps.length > 1 && (
                    <Button type="button" onClick={() => removeStep(index)}>
                      移除步骤
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {editing &&
            !confirmed &&
            document.steps.length > 0 &&
            document.steps.length < 16 && (
              <Button type="button" onClick={addStep}>
                添加步骤
              </Button>
            )}
        </fieldset>
      </ControlScope>
      {error && !confirmed && <Notice error>{error}</Notice>}
      {(pending || confirmation) && !confirmed && (
        <p className="hint">
          正在确认这份版本；结果不明时再次点击确认可找回原提交。
        </p>
      )}
      {!confirmed && !confirmation && (pending || dirty) && (
        <Button type="button" disabled={busy} onClick={() => void saveDraft()}>
          {pending ? "重试保存本次修改" : "保存计划修改"}
        </Button>
      )}
    </form>
  );
}

function PlanStepParameters({
  index,
  visible,
  disabled,
  children,
}: {
  index: number;
  visible: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<React.ComponentRef<typeof Button>>(null);
  useEffect(() => {
    if (!visible || disabled) setOpen(false);
  }, [visible, disabled]);
  return (
    <Popover
      trigger="click"
      placement="leftTop"
      title="图片设置"
      classNames={{ root: "creation-popover agent-settings-popover" }}
      open={open}
      onOpenChange={setOpen}
      content={
        <div
          className="agent-settings-content"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {children}
        </div>
      }
    >
      <Button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={`步骤 ${index + 1} 图片设置`}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <Settings2 size={15} aria-hidden="true" />
        图片设置
      </Button>
    </Popover>
  );
}
