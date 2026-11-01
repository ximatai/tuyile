import { useCreationPanel } from "./use-creation-panel";
import { LoadingState } from "./loading-state";
import {
  ProjectDraftBoundary,
  useDraftValue,
  useDraftMode,
  useDraftReferences,
} from "./project-draft";
import { ResultImage } from "./result-image";
import { TaskDetails, TaskProblem } from "./task-details";
import { canReuseTask, taskStates as states } from "./task-presentation";
import { useAdaptivePromptHeight } from "./use-adaptive-prompt-height";
import {
  Info,
  PanelRightClose,
  PanelRightOpen,
  WandSparkles,
  Bot,
  Pin,
  PinOff,
} from "lucide-react";
import { composeCreativePrompt } from "@tuyile/contracts";
import { HelpPopover } from "./interface-help";
import { PromptComposer } from "./prompt-composer";
import { GenerationFeedback } from "./generation-feedback";
import type { GenerationPhase } from "./generation-status";
import { ImageControls, ReferenceAttachments } from "./image-controls";
import {
  initialSettings,
  selectedCapability,
  settingsIssues,
  taskSettings,
} from "./image-settings";
import { AgentPanel } from "./agent-panel";
import { lazy, Suspense, useCallback } from "react";
const CanvasEditor = lazy(() =>
  import("./editor/canvas").then((m) => ({ default: m.CanvasEditor })),
);
import { useQuery } from "@tanstack/react-query";
import { useSessionState } from "./session-state";
import {
  useState,
  useEffect,
  useRef,
  useId,
  type FormEvent,
  type ComponentRef,
} from "react";
import type { ImageInput, ImageTask, ImageUsage } from "@tuyile/contracts";
import {
  Collapse,
  Popover,
  Button,
  Notice,
  useConfirm,
  useFeedback,
  Input,
  ControlScope,
  Tooltip,
} from "@tuyile/ui";
import { client, ApiError } from "./api";
function TaskTile({
  task: t,
  busy,
  onCancel,
  onRemove,
  onReuse,
  onReference,
}: {
  task: ImageTask;
  busy: boolean;
  onCancel: () => void;
  onRemove: (id: string) => void;
  onReuse?: (task: ImageTask) => void;
  onReference?: (id: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsTrigger = useRef<ComponentRef<typeof Button>>(null);
  function closeDetails(event: React.KeyboardEvent) {
    if (event.key === "Escape" && detailsOpen) {
      event.stopPropagation();
      setDetailsOpen(false);
      detailsTrigger.current?.focus();
    }
  }
  const active = ["queued", "running"].includes(t.state);
  return (
    <article
      className="task-result task-tile"
      aria-label={`图片任务 · ${states[t.state]}`}
    >
      <div className="output-grid task-tile-images">
        {t.outputs.length ? (
          t.outputs.map((a) => (
            <ResultImage
              key={a.id}
              asset={a}
              busy={busy}
              onRemove={onRemove}
              onReference={onReference}
              onReuse={
                onReuse && canReuseTask(t)
                  ? () => {
                      setDetailsOpen(false);
                      onReuse(t);
                    }
                  : undefined
              }
            />
          ))
        ) : (
          <div className="task-tile-placeholder">
            {t.pendingReview ? "结果待核验" : states[t.state]}
          </div>
        )}
      </div>
      <p className="task-tile-prompt" title={t.prompt}>
        {t.prompt}
      </p>
      <div className="task-tile-footer">
        <span className={`task-tile-state state-${t.state}`}>
          {t.pendingReview ? "待核验" : states[t.state]}
        </span>
        <span className="hint">
          {t.used}/{t.count} 张{t.held ? ` · 预留 ${t.held}` : ""}
        </span>
        <Popover
          trigger="click"
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          placement="topRight"
          classNames={{ root: "creation-popover task-details-popover" }}
          content={
            <div className="task-tile-details" onKeyDown={closeDetails}>
              <TaskDetails
                showProblem={false}
                task={t}
                onReuse={
                  onReuse
                    ? (task) => {
                        setDetailsOpen(false);
                        onReuse(task);
                      }
                    : undefined
                }
              />
            </div>
          }
        >
          <Button
            ref={detailsTrigger}
            type="button"
            className="help-trigger"
            aria-label="任务详情"
            aria-expanded={detailsOpen}
            onKeyDown={closeDetails}
          >
            <Info size={16} aria-hidden="true" />
          </Button>
        </Popover>
      </div>
      <TaskProblem task={t} />
      {active && (
        <Button disabled={busy || t.cancelRequested} onClick={onCancel}>
          {t.cancelRequested ? "正在取消…" : "取消任务"}
        </Button>
      )}
    </article>
  );
}
export function TaskResults({
  tasks,
  csrfToken,
  refresh,
  onReuse,
  onReference,
  compact = false,
}: {
  compact?: boolean;
  tasks: ImageTask[];
  csrfToken: string;
  refresh: () => void;
  onReuse?: (task: ImageTask) => void;
  onReference?: (id: string) => void;
}) {
  const confirm = useConfirm();
  const feedback = useFeedback();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function cancel(id: string) {
    setBusy(true);
    setError("");
    try {
      await client(csrfToken)(`/images/tasks/${id}/cancel`, {});
      feedback.success("已请求取消");
      refresh();
    } catch (e) {
      feedback.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (
      !(await confirm(
        "删除原图和预览？此操作不返还图片次数，仍被任务引用时不能删除。",
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await client(csrfToken)(`/images/assets/${id}/delete`, {});
      feedback.success("原图已删除");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="task-list">
      {error && <Notice error>{error}</Notice>}
      {!tasks.length && (
        <div className="empty">
          <h2>创作从一个想法开始</h2>
          <p>输入需求并提交，完成的图片会出现在这里。</p>
        </div>
      )}
      {tasks.map((t) =>
        compact ? (
          <TaskTile
            key={t.id}
            task={t}
            busy={busy}
            onCancel={() => void cancel(t.id)}
            onRemove={(id) => void remove(id)}
            onReuse={onReuse}
            onReference={onReference}
          />
        ) : (
          <article
            className="task-result"
            key={t.id}
            aria-label={`图片任务 · ${states[t.state]}`}
          >
            <div className="page-heading">
              <h2>
                {states[t.state]}
                {t.pendingReview ? " · 结果待核验" : ""}
              </h2>
              <span className="hint">
                {t.used} / {t.count} 张{t.held ? ` · ${t.held} 张预留` : ""}
              </span>
            </div>
            <TaskDetails task={t} onReuse={onReuse} />
            <div className="output-grid">
              {t.outputs.map((a) => (
                <ResultImage
                  key={a.id}
                  asset={a}
                  busy={busy}
                  onRemove={(id) => void remove(id)}
                  onReference={onReference}
                  onReuse={
                    onReuse && canReuseTask(t) ? () => onReuse(t) : undefined
                  }
                />
              ))}
            </div>
            {["queued", "running"].includes(t.state) && (
              <Button
                disabled={busy || t.cancelRequested}
                onClick={() => void cancel(t.id)}
              >
                {t.cancelRequested ? "正在取消…" : "取消任务"}
              </Button>
            )}
          </article>
        ),
      )}
    </div>
  );
}
export function CreationPage(props: { csrfToken: string; projectId: string }) {
  return (
    <ProjectDraftBoundary projectId={props.projectId}>
      <CreationEditor {...props} />
    </ProjectDraftBoundary>
  );
}
function CreationEditor({
  csrfToken,
  projectId,
}: {
  csrfToken: string;
  projectId: string;
}) {
  const sessionState = useSessionState();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useDraftValue("direct", "settings"),
    [prompt, setPrompt] = useDraftValue("direct", "prompt"),
    [style, setStyle] = useDraftValue("direct", "style"),
    [references, setReferences] = useDraftReferences(),
    [canvasSelection, setCanvasSelection] = useState<
      { id: string; name: string }[]
    >([]),
    [pending, setPending] = useState<ImageInput | null>(null),
    [mobile, setMobile] = useState("create");
  const panel = useCreationPanel();
  const panelCollapsed = panel.collapsed;
  const panelId = useId();
  const panelToggle = useRef<ComponentRef<typeof Button>>(null);
  const composing = useRef(false);
  function closeTemporaryPanel() {
    panel.hide();
    panelToggle.current?.focus({ preventScroll: true });
  }
  function togglePanel() {
    panel.toggle();
    panelToggle.current?.focus({ preventScroll: true });
    composing.current = false;
  }
  const confirmDraft = useConfirm();
  const chooseReference = useCallback(
    (id: string) => {
      panel.show();
      if (busy || pending) {
        setError("请先确认当前提交结果，再修改草稿。");
        return;
      }
      setReferences((v) =>
        v.some((r) => r.id === id) || v.length >= 4
          ? v
          : [...v, { id, name: "画布参考图" }],
      );
      setMobile("create");
    },
    [busy, pending, panel.show],
  );
  function useCanvasSelection() {
    if (busy || pending) {
      setError("请先确认当前提交结果，再修改参考图。");
      return;
    }
    const next = [
      ...new Map(
        [...references, ...canvasSelection].map((r) => [r.id, r]),
      ).values(),
    ];
    if (next.length > 4) {
      setError("参考图最多4张，请先移除部分引用。");
      return;
    }
    setReferences(next);
    setError("");
  }
  const [mode, setMode] = useDraftMode();
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [submissionRejected, setSubmissionRejected] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const usageQuery = useQuery({
    queryKey: sessionState.key("usage"),
    queryFn: ({ signal }) =>
      client(csrfToken)<ImageUsage>("/images/usage", undefined, signal),
    refetchInterval: 1500,
  });
  const taskQuery = useQuery({
    queryKey: sessionState.key("tasks", projectId),
    queryFn: ({ signal }) =>
      client(csrfToken)<{ tasks: ImageTask[] }>(
        `/images/tasks?projectId=${projectId}`,
        undefined,
        signal,
      ),
    refetchInterval: 1500,
  });
  const usage = usageQuery.data,
    tasks = taskQuery.data?.tasks ?? [];
  const generating = tasks.some(
    (t) => t.state === "running" || t.state === "queued",
  );
  const sameActiveDraft = tasks.some((task) => {
    if (
      !["queued", "running"].includes(task.state) ||
      task.prompt !== prompt.trim() ||
      task.count !== settings.count
    )
      return false;
    const saved = task.settings;
    if (!saved) return true;
    return (
      (saved.modelSelectionId ?? task.model) === settings.modelKey &&
      saved.width === settings.width &&
      saved.height === settings.height &&
      saved.quality === settings.quality &&
      saved.format === settings.format &&
      saved.style?.name === style?.name.trim() &&
      saved.style?.text === style?.text.trim() &&
      JSON.stringify(saved.referenceIds) ===
        JSON.stringify(references.map((r) => r.id))
    );
  });
  const running = tasks.some((t) => t.state === "running");
  function showTasks() {
    setHistoryOpen(true);
    requestAnimationFrame(() =>
      resultsRef.current
        ?.querySelector<HTMLElement>(
          ".canvas-task-history > .ant-collapse-item > .ant-collapse-header",
        )
        ?.focus({ preventScroll: true }),
    );
  }
  async function acceptTask(task: ImageTask) {
    await sessionState.queries.cancelQueries({
      queryKey: sessionState.key("tasks", projectId),
      exact: true,
    });
    sessionState.queries.setQueryData<{ tasks: ImageTask[] }>(
      sessionState.key("tasks", projectId),
      (old) =>
        old?.tasks.some((t) => t.id === task.id)
          ? old
          : { tasks: [task, ...(old?.tasks ?? [])] },
    );
  }
  const initialized = useRef(false);
  useEffect(() => {
    if (usage && usage.models.length && !initialized.current) {
      initialized.current = true;
      setSettings((old) => (old.modelKey ? old : initialSettings(usage)));
    }
  }, [usage]);
  const issues = usage
    ? [
        ...settingsIssues(usage, settings, references.length),
        ...(style && !style.text.trim() ? ["请填写风格描述。"] : []),
        ...(composeCreativePrompt({ prompt, style }).length > 12000
          ? ["需求与风格合计不能超过 12000 字符。"]
          : []),
      ]
    : [];
  async function reuse(task: ImageTask) {
    panel.show();
    if (["queued", "running"].includes(task.state)) {
      setError("请等待这次任务结束后再复用设置。");
      return;
    }
    if (task.pendingReview) {
      setError("请先核验这次任务的执行结果，再复用设置。");
      return;
    }
    if (!usage || busy || pending) {
      setError("请先确认当前提交结果，再复用设置。");
      return;
    }
    const next = taskSettings(task, usage);
    if (!next) return;
    if (
      (prompt.trim() ||
        references.length ||
        sessionState.replacesCreativeDraft(projectId, { task })) &&
      !(await confirmDraft("用这次任务的提示词、参数和参考图替换当前草稿？"))
    )
      return;
    initialized.current = true;
    setSettings(next);
    setPrompt(task.prompt);
    setStyle(task.settings?.style);
    setReferences(
      task.settings!.referenceIds.map((id) => ({ id, name: "任务参考图" })),
    );
    setError("");
    setMode("direct");
    setMobile("create");
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(),
    );
  }
  async function refresh() {
    await Promise.all([usageQuery.refetch(), taskQuery.refetch()]);
  }
  const [uploadError, setUploadError] = useState("");
  function reportUploadError(message: string) {
    setUploadError(message);
    panel.show();
  }
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  function upload(file: File | undefined) {
    return uploadFiles(file ? [file] : [], "reference");
  }
  async function uploadFiles(
    files: File[],
    destination: "reference" | "canvas",
  ) {
    if (
      !files.length ||
      uploadController.current ||
      active.current ||
      busy ||
      pending ||
      (destination === "reference" && references.length >= 4)
    )
      return;
    const editor = sessionState.editors.get(projectId);
    try {
      if (!editor) throw new Error("画布正在加载，请稍后再上传图片。");
      if (files.length > 20) throw new Error("每批最多上传 20 张图片。");
      editor.canAddImage(files.length);
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error(`${file.name}：图片不能超过 20 MiB。`);
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error(`${file.name}：仅支持 PNG、JPEG 和 WebP 图片。`);
      }
    } catch (e) {
      reportUploadError((e as Error).message);
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    setBusy(true);
    setUploadError("");
    setUploadProgress({ done: 0, total: files.length });
    let done = 0,
      uploaded = false;
    const inserted: string[] = [];
    try {
      for (const file of files) {
        if (controller.signal.aborted) return;
        uploaded = false;
        const response = await fetch("/api/images/uploads", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": file.type, "X-CSRF-Token": csrfToken },
          body: file,
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json();
          throw new ApiError(body.error.code);
        }
        const asset = await response.json();
        if (controller.signal.aborted) return;
        uploaded = true;
        if (destination === "reference")
          setReferences((v) =>
            v.length >= 4 || v.some((r) => r.id === asset.id)
              ? v
              : [...v, { id: asset.id, name: file.name }],
          );
        editor.addUploadedImage(asset, file.name);
        inserted.push(asset.id);
        done++;
        setUploadProgress({ done, total: files.length });
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const reason = uploaded
          ? `图片已上传，可在图库找回。${(e as Error).message}`
          : e instanceof ApiError
            ? e.message
            : "上传结果未确认，请先到图库查看，避免重复上传。";
        reportUploadError(
          files.length > 1
            ? `已加入 ${done}/${files.length} 张。${reason} 后续图片未上传。`
            : reason,
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        if (inserted.length)
          editor.select(
            editor
              .get()
              .document.nodes.filter((n) => inserted.includes(n.assetId ?? ""))
              .map((n) => n.id),
          );
        await refresh().catch(() => {
          if (!controller.signal.aborted)
            reportUploadError(
              "图片已加入画布，额度或任务信息未能刷新，请稍后重试。",
            );
        });
      }
      if (uploadController.current === controller)
        uploadController.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        setUploadProgress(null);
      }
    }
  }
  const formRef = useRef<HTMLFormElement>(null);
  const promptHeight = useAdaptivePromptHeight(
    formRef,
    !panelCollapsed && mode === "direct" && usageQuery.isSuccess,
  );
  async function send(input: ImageInput) {
    if (active.current) return;
    active.current = true;
    setPhase("submit");
    setSubmissionRejected(false);
    setBusy(true);
    setError("");
    setPending(input);
    try {
      const task = await client(csrfToken)<ImageTask>("/images/tasks", input);
      await acceptTask(task);
      setPending(null);
      setMobile("results");
      void refresh();
    } catch (e) {
      const rejected = e instanceof ApiError && e.code !== "INTERNAL_ERROR";
      if (rejected) {
        setPending(null);
        setSubmissionRejected(true);
      }
      setError(
        rejected
          ? (e as Error).message
          : `${(e as Error).message} 若提交结果未确认，请查找这次提交，或用同一请求重试。`,
      );
    } finally {
      active.current = false;
      setPhase("idle");
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) {
      void send(pending);
      return;
    }
    if (sameActiveDraft) return;
    if (!usage || issues.length) {
      setError(issues.join(" "));
      return;
    }
    void send({
      projectId,
      requestKey: crypto.randomUUID(),
      prompt,
      ...(style ? { style } : {}),
      model:
        usage.modelOptions?.find((m) => m.id === settings.modelKey)?.modelId ??
        settings.modelKey,
      ...(usage.modelOptions ? { modelSelectionId: settings.modelKey } : {}),
      width: settings.width,
      height: settings.height,
      quality: settings.quality,
      format: settings.format,
      count: settings.count,
      referenceIds: references.map((r) => r.id),
    });
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    setPhase("recover");
    try {
      const task = await client(csrfToken)<ImageTask>(
        `/images/recover?projectId=${projectId}&requestKey=${pending.requestKey}`,
      );
      await acceptTask(task);
      setPending(null);
      setError("");
      setMobile("results");
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
      setBusy(false);
    }
  }
  return (
    <section className="creation-workbench">
      <div className="mobile-creation-switch">
        <Button
          aria-pressed={mobile === "create"}
          onClick={() => setMobile("create")}
        >
          创作
        </Button>
        <Button
          aria-pressed={mobile === "results"}
          onClick={() => setMobile("results")}
        >
          任务与结果
        </Button>
      </div>
      <div
        className={`creation-layout show-${mobile}${panelCollapsed ? " creation-panel-collapsed" : ""}${!panel.pinned ? " creation-panel-unpinned" : ""}`}
        onKeyDownCapture={(event) => {
          const target = event.target;
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !event.nativeEvent.isComposing &&
            !composing.current &&
            !panel.pinned &&
            !panelCollapsed &&
            target instanceof Element &&
            event.currentTarget.contains(target) &&
            !target.closest(
              '.creation-panel,input,textarea,[contenteditable],[role=menu],[role=dialog],button[aria-expanded="true"],[aria-haspopup][aria-expanded="true"]',
            )
          ) {
            closeTemporaryPanel();
          }
        }}
      >
        <div
          className="creation-results"
          ref={resultsRef}
          onPointerDownCapture={(event) => {
            const target = event.target;
            if (
              !panel.pinned &&
              !panelCollapsed &&
              !composing.current &&
              target instanceof Element &&
              event.currentTarget.contains(target) &&
              target.closest(".react-flow__pane,.react-flow__node") &&
              !target.closest(
                "button,a,input,textarea,[contenteditable],.canvas-image-actions",
              )
            ) {
              panel.hide();
            }
          }}
        >
          <Suspense fallback={<LoadingState variant="canvas" />}>
            <CanvasEditor
              tasks={tasks}
              statusStale={!!taskQuery.error}
              projectId={projectId}
              onReference={chooseReference}
              onUpload={(files) => void uploadFiles(files, "canvas")}
              uploadBusy={busy || !!pending}
              onSelectionChange={setCanvasSelection}
              onReuse={(task) => void reuse(task)}
            />
          </Suspense>
          <Collapse
            className="canvas-task-history"
            activeKey={historyOpen ? ["history"] : []}
            onChange={(keys) => setHistoryOpen(keys.includes("history"))}
            ghost
            items={[
              {
                key: "history",
                label: `任务与结果 · ${tasks.length}`,
                children: (
                  <TaskResults
                    compact
                    tasks={tasks}
                    csrfToken={csrfToken}
                    refresh={() => void refresh()}
                    onReuse={(task) => void reuse(task)}
                    onReference={(id) => {
                      chooseReference(id);
                      setMode("direct");
                      requestAnimationFrame(() =>
                        formRef.current
                          ?.querySelector<HTMLTextAreaElement>("textarea")
                          ?.focus(),
                      );
                    }}
                  />
                ),
              },
            ]}
          />
        </div>
        <ControlScope componentDisabled={panelCollapsed}>
          <aside
            className="creation-panel"
            aria-label="图片创作"
            id={panelId}
            onMouseEnter={panel.cancelHover}
            onMouseLeave={panel.hoverEnd}
            onPointerDownCapture={() => {
              if (!panelCollapsed) panel.engage();
            }}
            onFocusCapture={() => {
              if (!panelCollapsed) panel.engage();
            }}
            onCompositionStartCapture={() => {
              composing.current = true;
            }}
            onCompositionEndCapture={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Escape" &&
                !event.defaultPrevented &&
                !event.nativeEvent.isComposing &&
                !composing.current &&
                !panel.pinned &&
                !panelCollapsed
              ) {
                event.preventDefault();
                event.stopPropagation();
                closeTemporaryPanel();
              }
            }}
          >
            <div className="creation-panel-heading">
              <h2 className="creation-panel-title">
                {mode === "direct" ? "直接创作" : "Agent"}
              </h2>
              {!panelCollapsed && (
                <Tooltip
                  title={panel.pinned ? "取消固定创作面板" : "固定创作面板"}
                  placement="bottom"
                  classNames={{ root: "creation-panel-control-tip" }}
                >
                  <Button
                    type="button"
                    className="creation-panel-pin"
                    aria-label={
                      panel.pinned ? "取消固定创作面板" : "固定创作面板"
                    }
                    aria-pressed={panel.pinned}
                    onClick={panel.togglePin}
                  >
                    {panel.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </Button>
                </Tooltip>
              )}
              <Tooltip
                title={panelCollapsed ? "展开创作面板" : "收起创作面板"}
                placement="bottomRight"
                classNames={{ root: "creation-panel-control-tip" }}
                trigger={["hover", "focus"]}
              >
                <Button
                  type="button"
                  disabled={false}
                  className="creation-panel-toggle"
                  aria-label={panelCollapsed ? "展开创作面板" : "收起创作面板"}
                  aria-expanded={!panelCollapsed}
                  aria-controls={panelId}
                  onClick={togglePanel}
                >
                  {panelCollapsed ? (
                    <PanelRightOpen size={16} />
                  ) : (
                    <PanelRightClose size={16} />
                  )}
                </Button>
              </Tooltip>
            </div>
            {uploadProgress && (
              <p role="status">
                正在上传 {uploadProgress.done}/{uploadProgress.total} 张…
              </p>
            )}
            {uploadError && <Notice error>{uploadError}</Notice>}
            <div
              className="direct-creation"
              hidden={mode !== "direct"}
              inert={panelCollapsed}
            >
              {(usageQuery.error || taskQuery.error) && (
                <Notice error>
                  {usageQuery.error?.message || taskQuery.error?.message}
                </Notice>
              )}
              {usage?.providerMode === "fake" && (
                <Notice>
                  本地测试模型：生成测试色块，不调用真实服务，不产生模型费用。
                </Notice>
              )}
              {usage && !usage.models.length && (
                <Notice>尚未配置可用的图片服务，请联系管理员。</Notice>
              )}
              <form ref={formRef} onSubmit={submit} aria-label="提交图片任务">
                <ControlScope
                  componentDisabled={
                    panelCollapsed || busy || !!pending || !usage?.models.length
                  }
                >
                  <fieldset
                    disabled={busy || !!pending || !usage?.models.length}
                  >
                    <PromptComposer
                      visible={!panelCollapsed && mode === "direct"}
                      height={promptHeight}
                      value={prompt}
                      onChange={setPrompt}
                      style={style}
                      onStyleChange={setStyle}
                    />
                    {mode === "direct" && (
                      <ReferenceAttachments
                        references={references}
                        selected={canvasSelection}
                        onUseSelected={useCanvasSelection}
                        onRemove={(id) =>
                          setReferences((v) => v.filter((r) => r.id !== id))
                        }
                        onUpload={(file) => void upload(file)}
                        disabled={busy || !!pending}
                        maxReferences={
                          usage
                            ? selectedCapability(usage, settings.modelKey)
                                ?.editing
                              ? selectedCapability(usage, settings.modelKey)!
                                  .maxReferences
                              : 0
                            : 0
                        }
                      />
                    )}
                    <ImageControls
                      disabled={busy || !!pending}
                      compact
                      usage={usage}
                      value={settings}
                      onChange={setSettings}
                    />
                  </fieldset>
                </ControlScope>
                {issues.length > 0 && !pending && (
                  <Notice error>{issues.join(" ")}</Notice>
                )}
                {error && <Notice error>{error}</Notice>}
                <GenerationFeedback
                  tasks={tasks}
                  phase={phase}
                  pending={!!pending}
                  stale={!!taskQuery.error}
                  rejected={submissionRejected}
                  onShow={showTasks}
                  ready={taskQuery.isSuccess}
                />
                <div className="generation-submit-row">
                  <Button
                    className="primary"
                    aria-busy={
                      busy ||
                      (!pending &&
                        (!prompt.trim() || sameActiveDraft) &&
                        generating &&
                        !taskQuery.error)
                    }
                    loading={
                      busy ||
                      (!pending &&
                        (!prompt.trim() || sameActiveDraft) &&
                        generating &&
                        !taskQuery.error)
                    }
                    aria-label={
                      pending && phase === "idle"
                        ? "重试同一提交"
                        : "提交图片任务"
                    }
                    disabled={
                      busy ||
                      !usage?.models.length ||
                      (!pending &&
                        (!prompt.trim() ||
                          sameActiveDraft ||
                          issues.length > 0))
                    }
                  >
                    {busy
                      ? phase === "submit"
                        ? "正在提交…"
                        : phase === "recover"
                          ? "正在查找…"
                          : "正在上传参考图…"
                      : pending
                        ? "重试同一提交"
                        : (!prompt.trim() || sameActiveDraft) && generating
                          ? taskQuery.error
                            ? "状态暂不可用"
                            : running
                              ? "正在生成…"
                              : "排队中…"
                          : `生成 ${settings.count} 张`}
                  </Button>
                  <HelpPopover
                    title="生成说明"
                    visible={!panelCollapsed && mode === "direct"}
                  >
                    生图任务是后台执行，关闭页面不影响任务执行和费用核算。
                  </HelpPopover>
                </div>
                {pending && (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void recover()}
                  >
                    查找这次提交
                  </Button>
                )}
              </form>
            </div>
            <div
              className="agent-creation"
              hidden={mode !== "agent"}
              inert={panelCollapsed}
            >
              <AgentPanel
                visible={!panelCollapsed && mode === "agent"}
                autoFocusComposer={panel.pinned || panel.engaged}
                projectId={projectId}
                usage={usage}
                tasks={tasks}
                references={references}
                selectedCanvas={canvasSelection}
                onUseSelected={useCanvasSelection}
                onRemove={(id) =>
                  setReferences((old) => old.filter((r) => r.id !== id))
                }
                onUpload={(file) => void upload(file)}
                uploadBusy={busy || !!pending}
              />
            </div>
          </aside>
        </ControlScope>
        <div
          className="creation-tool-rail"
          role="toolbar"
          aria-label="创作面板导航"
          onMouseEnter={panel.cancelHover}
          onMouseLeave={panel.hoverEnd}
        >
          {(["direct", "agent"] as const).map((key) => (
            <Tooltip
              key={key}
              title={key === "direct" ? "直接创作" : "Agent"}
              placement="left"
              classNames={{ root: "creation-panel-control-tip" }}
            >
              <Button
                type="button"
                ref={mode === key ? panelToggle : undefined}
                aria-label={key === "direct" ? "直接创作面板" : "Agent 面板"}
                aria-pressed={!panelCollapsed && mode === key}
                aria-controls={panelId}
                onMouseEnter={() => panel.hoverStart(() => setMode(key))}
                onMouseLeave={panel.cancelHover}
                onClick={() => {
                  composing.current = false;
                  if (
                    mode === key &&
                    !panelCollapsed &&
                    (panel.pinned || panel.engaged)
                  )
                    panel.hide();
                  else {
                    setMode(key);
                    panel.show();
                  }
                }}
              >
                {key === "direct" ? (
                  <WandSparkles size={17} />
                ) : (
                  <Bot size={17} />
                )}
              </Button>
            </Tooltip>
          ))}
        </div>
      </div>
    </section>
  );
}
