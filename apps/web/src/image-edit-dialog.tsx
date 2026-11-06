import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  composeCreativePrompt,
  type AnnotationStroke,
  type ImageInput,
  type ImageTask,
  type ImageUsage,
  type ProjectDraftDocument,
} from "@tuyile/contracts";
import {
  Button,
  Modal,
  Radio,
  Input,
  Field,
  Notice,
  Select,
  ControlScope,
} from "@tuyile/ui";
import { ProjectDraftProblem, useProjectDraft } from "./project-draft";
import { useSessionState } from "./session-state";
import { useTextReferences } from "./text-references";
import { ImageControls } from "./image-controls";
import { selectedCapability, settingsIssues } from "./image-settings";
import { StyleSelector } from "./style-selector";
import { client, ApiError } from "./api";
import { TaskProblem } from "./task-details";

type Edit = NonNullable<ProjectDraftDocument["edit"]>;
export function ImageEditDialog({
  projectId,
  usage,
  onClose,
  onRefresh,
  onDerive,
}: {
  projectId: string;
  usage?: ImageUsage;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDerive?: (task: ImageTask, assetId: string) => Promise<void>;
}) {
  const store = useProjectDraft(),
    state = useSessionState(),
    refs = useTextReferences();
  const snapshot = useSyncExternalStore(store.subscribe, store.get),
    edit = snapshot.document.edit!;
  const [kind, setKind] = useState<AnnotationStroke["kind"]>("ellipse");
  const [drawing, setDrawing] = useState<AnnotationStroke | null>(null),
    stroke = useRef<AnnotationStroke | null>(null);
  const [view, setView] = useState<"annotate" | "compare">(
    edit.resultTaskId && !edit.pendingInput ? "compare" : "annotate",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [baseReady, setBaseReady] = useState(false);
  const alive = useRef(true),
    inFlight = useRef(false),
    unresolved = useRef(false);
  unresolved.current = busy;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () =>
      state.registerNavigationGuard({
        isDirty: () => unresolved.current,
        canLeave: async () => !unresolved.current,
      }),
    [state],
  );
  const result = useQuery({
    queryKey: state.key("image-edit-result", edit.resultTaskId ?? ""),
    enabled: !!edit.resultTaskId,
    queryFn: ({ signal }) =>
      client(state.session.csrfToken)<ImageTask>(
        `/images/tasks/${edit.resultTaskId}`,
        undefined,
        signal,
      ),
    refetchInterval: 1500,
  });
  const task = result.data,
    output = task?.outputs.find((a) => !a.deleted);
  const active = !!task && ["queued", "running"].includes(task.state);
  const locked =
    busy ||
    !!edit.pendingInput ||
    active ||
    !!task?.pendingReview ||
    (!!edit.resultTaskId && (!task || !!result.error));
  const adoptable =
    !locked &&
    task?.projectId === projectId &&
    task.settings?.referenceIds[0] === edit.baseAssetId
      ? output
      : undefined;
  const cap = usage && selectedCapability(usage, edit.settings.modelKey);
  const errors = usage
    ? settingsIssues(usage, edit.settings, 1)
    : ["模型配置正在加载。"];
  if (edit.annotation.strokes.length && !cap?.markup)
    errors.push("当前服务未开放标注修改，请选择支持的模型或清除标注。");
  const textSources = (edit.textNodeIds ?? []).flatMap((id) => {
    const n = refs.nodes.find((n) => n.id === id);
    return n ? [{ nodeId: id, title: n.label, text: n.text ?? "" }] : [];
  });
  if (
    (edit.textNodeIds ?? []).some(
      (id) => !textSources.some((s) => s.nodeId === id && s.text.trim()),
    )
  )
    errors.push("引用文案已失效，请重新选择。");
  if (composeCreativePrompt({ ...edit, textSources }).length > 12000)
    errors.push("需求、文案、风格与保持要求合计超过12000字。");
  function patch(change: Partial<Edit>) {
    const current = store.get().document.edit;
    if (current) store.edit({ edit: { ...current, ...change } });
  }
  async function close() {
    if (busy) return;
    try {
      await store.flush();
      if (alive.current) onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function continueWithResult() {
    if (!adoptable || inFlight.current) return;
    const current = store.get().document.edit;
    if (current !== edit) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setBaseReady(false);
    stroke.current = null;
    setDrawing(null);
    patch({
      baseAssetId: adoptable.id,
      prompt: "",
      annotation: { version: 1, strokes: [] },
      resultTaskId: undefined,
    });
    setView("annotate");
    try {
      await store.flush();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function point(e: React.PointerEvent<SVGSVGElement>): [number, number] {
    const b = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(10000, Math.round(((e.clientX - b.left) / b.width) * 10000)),
      ),
      Math.max(
        0,
        Math.min(10000, Math.round(((e.clientY - b.top) / b.height) * 10000)),
      ),
    ];
  }
  function begin(e: React.PointerEvent<SVGSVGElement>) {
    if (locked || e.button !== 0 || edit.annotation.strokes.length >= 80)
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    stroke.current = { kind, points: [p, p] };
    setDrawing(stroke.current);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const s = stroke.current;
    if (!s) return;
    const p = point(e);
    if (s.kind === "ellipse")
      stroke.current = { ...s, points: [s.points[0], p] };
    else if (s.points.length < 256)
      stroke.current = { ...s, points: [...s.points, p] };
    setDrawing(stroke.current);
  }
  function end() {
    const s = stroke.current;
    if (!s) return;
    const next = {
      version: 1 as const,
      strokes: [...edit.annotation.strokes, s],
    };
    if (next.strokes.reduce((n, s) => n + s.points.length, 0) > 2000)
      setError("标注已达到点数上限，请撤销部分标注。");
    else patch({ annotation: next });
    stroke.current = null;
    setDrawing(null);
  }
  async function submit() {
    if (
      inFlight.current ||
      (!edit.pendingInput && (locked || errors.length || !edit.prompt.trim()))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let input = edit.pendingInput;
    try {
      if (!input) {
        const revision = edit.textNodeIds?.length
          ? await refs.flush()
          : undefined;
        const choice = usage?.modelOptions?.find(
          (m) => m.id === edit.settings.modelKey,
        );
        input = {
          projectId,
          requestKey: crypto.randomUUID(),
          prompt: edit.prompt,
          style: edit.style,
          preserveRequirements: edit.preserveRequirements,
          model: choice?.modelId ?? edit.settings.modelKey,
          ...(choice ? { modelSelectionId: choice.id } : {}),
          width: edit.settings.width,
          height: edit.settings.height,
          quality: edit.settings.quality,
          format: edit.settings.format,
          complexity: edit.settings.complexity,
          count: 1,
          referenceIds: [edit.baseAssetId],
          textNodeIds: edit.textNodeIds ?? [],
          ...(revision !== undefined ? { textCanvasRevision: revision } : {}),
          ...(edit.annotation.strokes.length
            ? { annotation: edit.annotation }
            : {}),
          editSession: true,
        };
        patch({ pendingInput: input });
      }
      // Persist the immutable submission before sending; reopen can retry this exact request.
      await store.flush();
      let accepted: ImageTask | null = null;
      try {
        accepted = await client(state.session.csrfToken)<ImageTask>(
          `/images/recover?projectId=${projectId}&requestKey=${input.requestKey}`,
          undefined,
          AbortSignal.timeout(10000),
        );
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "NOT_FOUND")) throw e;
      }
      accepted ??= await client(state.session.csrfToken)<ImageTask>(
        "/images/tasks",
        input,
        AbortSignal.timeout(10000),
      );
      if (!alive.current) return;
      patch({ pendingInput: undefined, resultTaskId: accepted.id });
      await store.flush();
      await onRefresh();
      setView("compare");
    } catch (e) {
      if (alive.current) {
        if (
          e instanceof ApiError &&
          !["INTERNAL_ERROR", "UNAUTHENTICATED"].includes(e.code)
        ) {
          patch({ pendingInput: undefined });
        }
        setError((e as Error).message);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const strokes = [...edit.annotation.strokes, ...(drawing ? [drawing] : [])];
  return (
    <Modal
      open
      title="修改图片"
      width={1200}
      onCancel={() => void close()}
      mask={{ closable: !busy }}
      keyboard={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={() => void close()}>
            保存并关闭
          </Button>
          {view === "compare" && adoptable ? (
            <>
              <Button onClick={() => setView("annotate")}>基于原图再试</Button>
              <a
                className="button"
                href={`/api/images/assets/${adoptable.id}/download`}
              >
                下载修改稿
              </a>
              {onDerive && task && (
                <Button
                  onClick={() =>
                    void onDerive(task, adoptable.id).catch((cause: Error) =>
                      setError(cause.message),
                    )
                  }
                >
                  用修改稿做 Agent 衍生
                </Button>
              )}
              <Button
                className="primary"
                onClick={() => void continueWithResult()}
              >
                用修改稿继续修改
              </Button>
            </>
          ) : (
            <Button
              className="primary"
              disabled={
                busy ||
                (!edit.pendingInput &&
                  (locked ||
                    !!errors.length ||
                    !edit.prompt.trim() ||
                    !baseReady))
              }
              onClick={() => void submit()}
            >
              {edit.pendingInput
                ? "找回／重试原提交"
                : active
                  ? "正在修改…"
                  : "生成修改结果"}
            </Button>
          )}
        </>
      }
    >
      <div className="image-edit-layout">
        <section>
          <Radio.Group
            value={view}
            onChange={(e) => setView(e.target.value)}
            optionType="button"
            options={[
              { value: "annotate", label: "标注原图" },
              { value: "compare", label: "前后比较" },
            ]}
          />
          {view === "annotate" ? (
            <>
              <div className="image-edit-tools">
                <Radio.Group
                  disabled={locked}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  optionType="button"
                  options={[
                    { value: "ellipse", label: "圈选" },
                    { value: "pen", label: "画笔" },
                  ]}
                />
                <Button
                  disabled={locked || !edit.annotation.strokes.length}
                  onClick={() =>
                    patch({
                      annotation: {
                        version: 1,
                        strokes: edit.annotation.strokes.slice(0, -1),
                      },
                    })
                  }
                >
                  撤销标注
                </Button>
                <Button
                  disabled={locked || !edit.annotation.strokes.length}
                  onClick={() =>
                    patch({ annotation: { version: 1, strokes: [] } })
                  }
                >
                  清除标注
                </Button>
              </div>
              <div className="annotation-surface">
                <img
                  src={`/api/images/assets/${edit.baseAssetId}/original`}
                  alt="待修改原图"
                  onLoad={() => setBaseReady(true)}
                  onError={() => {
                    setBaseReady(false);
                    setError("原图无法读取，请重试或从图库重新选择。");
                  }}
                />
                <svg
                  aria-label="图片标注区域"
                  viewBox="0 0 10000 10000"
                  preserveAspectRatio="none"
                  onPointerDown={begin}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={() => {
                    stroke.current = null;
                    setDrawing(null);
                  }}
                >
                  <g
                    fill="none"
                    stroke="#ff3030"
                    strokeWidth={45}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {strokes.map((s, i) =>
                      s.kind === "pen" ? (
                        <polyline
                          key={i}
                          points={s.points.map((p) => p.join(",")).join(" ")}
                        />
                      ) : (
                        <ellipse
                          key={i}
                          cx={(s.points[0][0] + s.points[1][0]) / 2}
                          cy={(s.points[0][1] + s.points[1][1]) / 2}
                          rx={Math.abs(s.points[1][0] - s.points[0][0]) / 2}
                          ry={Math.abs(s.points[1][1] - s.points[0][1]) / 2}
                        />
                      ),
                    )}
                  </g>
                </svg>
              </div>
              <p className="hint">
                圈出修改位置，并描述要如何改变；圈外内容仍可能变化。
              </p>
            </>
          ) : (
            <div className="image-edit-comparison">
              <figure>
                <img
                  src={`/api/images/assets/${edit.baseAssetId}/original`}
                  alt="比较原图"
                />
                <figcaption>原图</figcaption>
              </figure>
              <figure>
                {output ? (
                  <img
                    src={`/api/images/assets/${output.id}/original`}
                    alt="修改结果"
                  />
                ) : (
                  <p>
                    {active
                      ? "正在后台生成修改结果。"
                      : "尚无可比较的结果，或结果已删除。"}
                  </p>
                )}
                <figcaption>修改结果</figcaption>
              </figure>
            </div>
          )}
          {task && <TaskProblem task={task} />}
          {result.error && (
            <Notice error>修改结果暂时无法读取，请稍后重试。</Notice>
          )}
        </section>
        <ControlScope componentDisabled={locked}>
          <div className="image-edit-form">
            <label className="field">
              <span>修改需求</span>
              <Input.TextArea
                aria-label="修改需求"
                value={edit.prompt}
                maxLength={12000}
                rows={4}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
            </label>
            <Field
              label="保持要求"
              value={edit.preserveRequirements ?? ""}
              maxLength={2000}
              onChange={(e) => patch({ preserveRequirements: e.target.value })}
            />
            <StyleSelector
              style={edit.style}
              onChange={(style) => patch({ style })}
            />
            <label className="field">
              <span>引用文案</span>
              <Select
                aria-label="修改引用文案"
                mode="multiple"
                maxCount={8}
                value={edit.textNodeIds ?? []}
                options={refs.nodes.map((n) => ({
                  value: n.id,
                  label: n.label || "未命名文案",
                }))}
                onChange={(textNodeIds) => patch({ textNodeIds })}
              />
            </label>
            <ImageControls
              usage={usage}
              value={edit.settings}
              onChange={(settings) =>
                patch({ settings: { ...settings, count: 1 } })
              }
              count={false}
              compact
            />
          </div>
        </ControlScope>
      </div>
      {edit.pendingInput && (
        <Notice>
          提交结果尚待确认，输入已保存。请找回原提交，避免重复生成。
        </Notice>
      )}
      {errors.map((e) => (
        <Notice key={e} error>
          {e}
        </Notice>
      ))}
      <ProjectDraftProblem store={store} disabled={busy} />
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
