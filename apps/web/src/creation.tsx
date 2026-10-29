import { AgentPanel } from "./agent-panel";
import { Link } from "react-router-dom";
import { lazy, Suspense, useCallback } from "react";
const CanvasEditor = lazy(() =>
  import("./editor/canvas").then((m) => ({ default: m.CanvasEditor })),
);
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useSessionState } from "./session-state";
import { useState, useEffect, useRef, type FormEvent } from "react";
import type { ImageInput, ImageTask, ImageUsage } from "@tuyile/contracts";
import {
  Tabs,
  Button,
  Field,
  Notice,
  useConfirm,
  ChoiceField,
  Upload,
  Input,
  ControlScope,
} from "@tuyile/ui";
import { client, ApiError } from "./api";
const states: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "未完成",
  cancelled: "已取消",
};
export function TaskResults({
  tasks,
  csrfToken,
  refresh,
}: {
  tasks: ImageTask[];
  csrfToken: string;
  refresh: () => void;
}) {
  const confirm = useConfirm();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function cancel(id: string) {
    setBusy(true);
    setError("");
    try {
      await client(csrfToken)(`/images/tasks/${id}/cancel`, {});
      refresh();
    } catch (e) {
      setError((e as Error).message);
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
      {tasks.map((t) => (
        <article className="task-result" key={t.id}>
          <div className="page-heading">
            <h2>
              {states[t.state]}
              {t.pendingReview ? " · 结果待核验" : ""}
            </h2>
            <span className="hint">
              {t.used} / {t.count} 张{t.held ? ` · ${t.held} 张预留` : ""}
            </span>
          </div>
          <p className="task-prompt">{t.prompt}</p>
          <div className="hint">
            {t.model} · {new Date(t.createdAt).toLocaleString("zh-CN")}
          </div>
          {t.pendingReview && (
            <Notice>
              上游结果暂不确定，相关额度仍预留。请联系管理员核验，不要重复生成。
            </Notice>
          )}
          {t.errorCode && !t.pendingReview && (
            <Notice error>
              {t.errorCode === "WORKER_INTERRUPTED"
                ? "后台执行中断，已保存图片仍可查看。"
                : `任务未全部完成（${t.errorCode}）。已保存的图片会保留。`}
            </Notice>
          )}
          <div className="output-grid">
            {t.outputs.map((a) => (
              <figure key={a.id}>
                {a.deleted ? (
                  <p>原图已删除</p>
                ) : (
                  <>
                    <a
                      href={`/api/images/assets/${a.id}/original`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/api/images/assets/${a.id}/preview`}
                        alt={`已保存图片，${a.width} × ${a.height}`}
                        loading="lazy"
                      />
                    </a>
                    <figcaption>
                      {a.width} × {a.height}
                      <a href={`/api/images/assets/${a.id}/download`}>
                        下载原图
                      </a>
                    </figcaption>
                    <Button disabled={busy} onClick={() => void remove(a.id)}>
                      删除原图
                    </Button>
                  </>
                )}
              </figure>
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
      ))}
    </div>
  );
}
export function UsageSummary({ usage }: { usage: ImageUsage }) {
  return (
    <div className="usage-summary">
      <h2>今日图片额度</h2>
      <div className="usage-numbers">
        <span>
          已用 <strong>{usage.used}</strong>
        </span>
        <span>
          预留 <strong>{usage.held}</strong>
        </span>
        <span>
          可用 <strong>{usage.available}</strong>
        </span>
      </div>
      {usage.earlierHeld > 0 && (
        <p className="hint">历史日期另有 {usage.earlierHeld} 张待结算预留。</p>
      )}
      <p className="hint">
        上游尝试 {usage.attempts} / {usage.policy.attemptsLimit} · 每日上海时间
        00:00 切换
      </p>
      <p className="hint">
        存储{" "}
        {((usage.storageUsed + usage.storageReserved) / 1048576).toFixed(1)} /{" "}
        {(usage.policy.storageLimit / 1048576).toFixed(0)} MiB（包含预留）
      </p>
      <p className="hint">次数额度不等于费用上限；费用未知时不显示估算账单。</p>
    </div>
  );
}
export function CreationPage({
  csrfToken,
  projectId,
}: {
  csrfToken: string;
  projectId: string;
}) {
  const sessionState = useSessionState();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [model, setModel] = useState(""),
    [prompt, setPrompt] = useState(""),
    [references, setReferences] = useState<{ id: string; name: string }[]>([]),
    [pending, setPending] = useState<ImageInput | null>(null),
    [mobile, setMobile] = useState("create");
  const transferredDraft = useRef(sessionState.creationDrafts.get(projectId));
  useEffect(() => {
    const draft = transferredDraft.current;
    if (!draft) return;
    if (draft.prompt !== undefined) setPrompt(draft.prompt);
    if (draft.referenceIds)
      setReferences(
        draft.referenceIds.map((id) => ({ id, name: "图库参考图" })),
      );
    sessionState.creationDrafts.delete(projectId);
  }, [projectId, sessionState]);
  const chooseReference = useCallback(
    (id: string) =>
      setReferences((v) =>
        v.some((r) => r.id === id) || v.length >= 4
          ? v
          : [...v, { id, name: "画布参考图" }],
      ),
    [],
  );
  const [mode, setMode] = useState("direct");
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
  useEffect(() => {
    if (usage)
      setModel((m) => (usage.models.includes(m) ? m : (usage.models[0] ?? "")));
  }, [usage]);
  async function refresh() {
    await Promise.all([usageQuery.refetch(), taskQuery.refetch()]);
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("参考图不能超过 20 MiB。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/images/uploads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": file.type, "X-CSRF-Token": csrfToken },
        body: file,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new ApiError(body.error.code);
      }
      const asset = await response.json();
      setReferences((v) => [...v, { id: asset.id, name: file.name }]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const formRef = useRef<HTMLFormElement>(null);
  async function send(input: ImageInput) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setPending(input);
    try {
      await client(csrfToken)("/images/tasks", input);
      setPending(null);
      setPrompt("");
      setMobile("results");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
        setPending(null);
      setError(
        `${(e as Error).message} 若提交结果未确认，请查找这次提交，或用同一请求重试。`,
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) {
      void send(pending);
      return;
    }
    const f = new FormData(e.currentTarget);
    void send({
      projectId,
      requestKey: crypto.randomUUID(),
      prompt: String(f.get("prompt")),
      model,
      width: Number(f.get("width")),
      height: Number(f.get("height")),
      quality: f.get("quality") as ImageInput["quality"],
      format: f.get("format") as ImageInput["format"],
      count: Number(f.get("count")),
      referenceIds: references.map((r) => r.id),
    });
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    try {
      await client(csrfToken)(
        `/images/recover?projectId=${projectId}&requestKey=${pending.requestKey}`,
      );
      setPending(null);
      setError("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
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
      <div className={`creation-layout show-${mobile}`}>
        <div className="creation-results">
          <Suspense fallback={<p role="status">正在加载画布…</p>}>
            <CanvasEditor
              tasks={tasks}
              projectId={projectId}
              onReference={chooseReference}
            />
          </Suspense>
          <details className="canvas-task-history" open={tasks.length > 0}>
            <summary>任务与结果 · {tasks.length}</summary>
            <TaskResults
              tasks={tasks}
              csrfToken={csrfToken}
              refresh={() => void refresh()}
            />
          </details>
        </div>
        <aside className="creation-panel" aria-label="图片创作">
          <Tabs
            activeKey={mode}
            onChange={setMode}
            items={[
              { key: "direct", label: "直接创作" },
              { key: "agent", label: "Agent" },
            ]}
          />
          <div className="direct-creation" hidden={mode !== "direct"}>
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
                componentDisabled={busy || !!pending || !usage?.models.length}
              >
                <fieldset disabled={busy || !!pending || !usage?.models.length}>
                  <label className="field">
                    <span>创作需求</span>
                    <Input.TextArea
                      name="prompt"
                      aria-label="创作需求"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      required
                      maxLength={12000}
                      rows={5}
                      placeholder="描述画面、主体、风格和文字要求"
                    />
                  </label>
                  <ChoiceField
                    label="图片模型"
                    value={model}
                    onValueChange={setModel}
                    options={(usage?.models ?? []).map((m) => ({
                      value: m,
                      label: m,
                    }))}
                  />
                  <div className="parameter-grid">
                    <Field
                      label="宽度"
                      name="width"
                      type="number"
                      defaultValue={1024}
                      min={256}
                      max={usage?.policy.maxEdge ?? 2048}
                      step={16}
                      required
                    />
                    <Field
                      label="高度"
                      name="height"
                      type="number"
                      defaultValue={1024}
                      min={256}
                      max={usage?.policy.maxEdge ?? 2048}
                      step={16}
                      required
                    />
                    <ChoiceField
                      label="质量"
                      name="quality"
                      defaultValue="medium"
                      options={[
                        { value: "low", label: "低" },
                        { value: "medium", label: "中" },
                        { value: "high", label: "高" },
                      ]}
                    />
                    <ChoiceField
                      label="格式"
                      name="format"
                      defaultValue="png"
                      options={[
                        { value: "png", label: "PNG" },
                        { value: "jpeg", label: "JPEG" },
                        { value: "webp", label: "WebP" },
                      ]}
                    />
                    <Field
                      label="图片张数"
                      name="count"
                      type="number"
                      min={1}
                      max={usage?.policy.maxCount ?? 4}
                      defaultValue={1}
                      required
                    />
                  </div>
                  <div className="field" data-testid="reference-upload">
                    <span>上传参考图（可选）</span>
                    <Upload
                      accept="image/png,image/jpeg,image/webp"
                      showUploadList={false}
                      disabled={busy || references.length >= 4}
                      beforeUpload={(file) => {
                        void upload(file);
                        return false;
                      }}
                    >
                      <Button type="button">选择参考图</Button>
                    </Upload>
                  </div>
                  {references.map((r) => (
                    <div className="reference-row" key={r.id}>
                      <img
                        src={`/api/images/assets/${r.id}/preview`}
                        alt="参考图"
                      />
                      <span>{r.name}</span>
                      <Button
                        type="button"
                        onClick={() =>
                          setReferences((v) => v.filter((a) => a.id !== r.id))
                        }
                      >
                        移除引用
                      </Button>
                    </div>
                  ))}
                </fieldset>
              </ControlScope>
              {error && <Notice error>{error}</Notice>}
              <p className="hint">
                提交后后台排队，关页、刷新和普通退出登录不影响执行。取消可能仍计费；后台中断允许失败，已保存结果保留。整单预留额度，不足时不会自动降低规格。
              </p>
              <Button
                className="primary"
                disabled={busy || !usage?.models.length}
              >
                {busy ? "正在提交…" : pending ? "重试同一提交" : "提交图片任务"}
              </Button>
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
            {usage && (
              <details className="quota-details">
                <summary>
                  今日可用 {usage.available} 张 · 预留 {usage.held} 张
                </summary>
                <UsageSummary usage={usage} />
              </details>
            )}
            <Link to="/usage">查看全部任务与额度</Link>
          </div>
          <div className="agent-creation" hidden={mode !== "agent"}>
            <AgentPanel
              visible={mode === "agent"}
              projectId={projectId}
              usage={usage}
              tasks={tasks}
              references={references}
              onRemove={(id) =>
                setReferences((old) => old.filter((r) => r.id !== id))
              }
              onUpload={(file) => void upload(file)}
              uploadBusy={busy}
            />
          </div>
        </aside>
      </div>
    </section>
  );
}
export function UsagePage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState();
  const api = client(csrfToken);
  const [error, setError] = useState("");
  const usageQuery = useQuery({
    queryKey: state.key("usage"),
    queryFn: ({ signal }) =>
      api<ImageUsage>("/images/usage", undefined, signal),
  });
  const tasksQuery = useInfiniteQuery({
    queryKey: state.key("all-image-tasks"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<{ tasks: ImageTask[]; hasMore: boolean }>(
        `/images/tasks?offset=${pageParam}`,
        undefined,
        signal,
      ),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const usage = usageQuery.data,
    tasks = [
      ...new Map(
        (tasksQuery.data?.pages.flatMap((p) => p.tasks) ?? []).map((t) => [
          t.id,
          t,
        ]),
      ).values(),
    ];
  async function refresh() {
    setError("");
    try {
      await Promise.all([
        usageQuery.refetch({ throwOnError: true }),
        tasksQuery.refetch({ throwOnError: true }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function load() {
    try {
      await tasksQuery.fetchNextPage({ throwOnError: true });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section>
      <h1>我的额度与任务</h1>
      {(error || usageQuery.error || tasksQuery.error) && (
        <Notice error>
          {error || usageQuery.error?.message || tasksQuery.error?.message}
        </Notice>
      )}
      {usage && <UsageSummary usage={usage} />}
      <Button onClick={() => void refresh()}>刷新状态</Button>
      <TaskResults
        tasks={tasks}
        csrfToken={csrfToken}
        refresh={() => void refresh()}
      />
      {tasksQuery.hasNextPage && (
        <Button
          disabled={tasksQuery.isFetchingNextPage}
          onClick={() => void load()}
        >
          加载更多任务
        </Button>
      )}
      <UploadedReferences csrfToken={csrfToken} />
    </section>
  );
}

export function UploadedReferences({ csrfToken }: { csrfToken: string }) {
  const confirm = useConfirm();
  const state = useSessionState();
  const [error, setError] = useState("");
  const query = useInfiniteQuery({
    queryKey: state.key("uploads"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      client(csrfToken)<{
        assets: { id: string; width: number; height: number }[];
        hasMore: boolean;
      }>(`/images/uploads?offset=${pageParam}`, undefined, signal),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const assets = [
    ...new Map(
      (query.data?.pages.flatMap((p) => p.assets) ?? []).map((a) => [a.id, a]),
    ).values(),
  ];
  async function load() {
    try {
      await query.fetchNextPage({ throwOnError: true });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(id: string) {
    if (!(await confirm("删除这张上传的参考图？正在被任务引用时不会删除。")))
      return;
    try {
      await client(csrfToken)(`/images/assets/${id}/delete`, {});
      await Promise.all(
        ["uploads", "gallery", "usage"].map((key) =>
          state.queries.invalidateQueries({ queryKey: state.key(key) }),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="settings-section">
      <h2>上传的参考图</h2>
      <p className="hint">解除引用后可删除不再使用的图片，释放存储空间。</p>
      {(error || query.error) && (
        <Notice error>{error || query.error?.message}</Notice>
      )}
      <div className="output-grid">
        {assets.map((a) => (
          <figure key={a.id}>
            <img
              src={`/api/images/assets/${a.id}/preview`}
              alt={`参考图 ${a.width} × ${a.height}`}
            />
            <Button onClick={() => void remove(a.id)}>删除参考图</Button>
          </figure>
        ))}
      </div>
      {query.hasNextPage && (
        <Button onClick={() => void load()}>加载更多参考图</Button>
      )}
    </section>
  );
}
