import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  type Favorite,
  type FavoriteInput,
  type GalleryAsset,
  type AssetReference,
  type CanvasSave,
  type CanvasSnapshot,
  type ProjectsPage,
  type PromptTemplatesPage,
} from "@tuyile/contracts";
import {
  Button,
  Checkbox,
  ChoiceField,
  Field,
  Input,
  Notice,
  Dropdown,
  Drawer,
  useConfirm,
  Tooltip,
} from "@tuyile/ui";
import { MoreHorizontal, Bookmark, ArrowRight } from "lucide-react";
import { HelpPopover, Excerpt } from "./interface-help";
import { ApiError, client } from "./api";
import { useSessionState } from "./session-state";
type Mode = "gallery" | "prompts" | "favorites";
interface ReuseRequest {
  project: string;
  input: CanvasSave;
  newIds: string[];
}
export function LibraryPage({ mode }: { mode: Mode }) {
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    navigate = useNavigate(),
    confirm = useConfirm();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [group, setGroup] = useState("__all__"),
    [editing, setEditing] = useState<FavoriteInput | null>(null),
    [references, setReferences] = useState<AssetReference[]>([]),
    [pendingReuse, setPendingReuse] = useState<ReuseRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const action = useRef(false),
    pendingFavorite = useRef<FavoriteInput | null>(null);
  const projects = useInfiniteQuery({
    queryKey: state.key("library-projects"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<ProjectsPage>(`/projects?offset=${pageParam}`, undefined, signal),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const assets = useInfiniteQuery({
    queryKey: state.key("gallery"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<{ assets: GalleryAsset[]; hasMore: boolean }>(
        `/library/assets?offset=${pageParam}`,
        undefined,
        signal,
      ),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
    enabled: mode === "gallery",
  });
  const favorites = useInfiniteQuery({
    queryKey: state.key("favorites", group),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<{ favorites: Favorite[]; hasMore: boolean }>(
        `/library/favorites?offset=${pageParam}${group !== "__all__" ? `&group=${encodeURIComponent(group.slice(6))}` : ""}`,
        undefined,
        signal,
      ),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
    enabled: mode === "favorites",
  });
  const groups = useQuery({
    queryKey: state.key("favorite-groups"),
    queryFn: ({ signal }) =>
      api<{ groups: string[] }>("/library/groups", undefined, signal),
  });
  const prompts = useInfiniteQuery({
    queryKey: state.key("prompt-templates"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<PromptTemplatesPage>(
        `/library/prompts?offset=${pageParam}`,
        undefined,
        signal,
      ),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
    enabled: mode === "prompts",
    staleTime: 0,
    refetchInterval: mode === "prompts" ? 15000 : false,
  });
  const allPrompts = [
    ...new Map(
      (prompts.data?.pages.flatMap((p) => p.prompts) ?? []).map((p) => [
        p.id,
        p,
      ]),
    ).values(),
  ];
  const allProjects = projects.data?.pages.flatMap((p) => p.projects) ?? [],
    project = target || allProjects[0]?.id || "",
    allAssets = assets.data?.pages.flatMap((p) => p.assets) ?? [];
  async function refresh() {
    await Promise.all([
      state.queries.invalidateQueries({ queryKey: state.key("gallery") }),
      state.queries.invalidateQueries({ queryKey: state.key("favorites") }),
      state.queries.invalidateQueries({
        queryKey: state.key("favorite-groups"),
      }),
      state.queries.invalidateQueries({ queryKey: state.key("usage") }),
    ]);
  }
  async function run(work: () => Promise<void>) {
    if (action.current) return;
    action.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      action.current = false;
      setBusy(false);
    }
  }
  function startFavorite(input: Partial<FavoriteInput>) {
    setError("");
    setMessage("");
    pendingFavorite.current = null;
    setEditing({
      id: input.id ?? crypto.randomUUID(),
      title: input.title ?? "图片收藏",
      groupName: input.groupName ?? "",
      ...(input.assetId
        ? { assetId: input.assetId }
        : { prompt: input.prompt ?? "" }),
    });
  }
  async function saveFavorite(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await run(async () => {
      const input = pendingFavorite.current ?? editing;
      pendingFavorite.current = input;
      try {
        await api("/library/favorites", input);
      } catch (e) {
        if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
          pendingFavorite.current = null;
        throw e;
      }
      pendingFavorite.current = null;
      setEditing(null);
      await refresh();
      setMessage("收藏已保存。");
    });
  }
  async function removeFavorite(id: string) {
    if (!(await confirm("移除这条收藏？原图和生图计次不变。"))) return;
    await run(async () => {
      await api(`/library/favorites/${id}/delete`, {});
      await refresh();
    });
  }
  async function removeAsset(id: string) {
    if (
      !(await confirm(
        "删除原图及预览？已用图片次数不会返还，仍有引用时不能删除。",
      ))
    )
      return;
    await run(async () => {
      setReferences([]);
      try {
        await api(`/images/assets/${id}/delete`, {});
      } catch (e) {
        if (e instanceof ApiError && e.code === "ASSET_REFERENCED") {
          const result = await api<{ references: AssetReference[] }>(
            `/library/assets/${id}/references`,
          );
          setReferences(result.references);
        }
        throw e;
      }
      setSelected((old) => old.filter((v) => v !== id));
      await refresh();
      setMessage("原图已删除。");
    });
  }
  async function openProjectDraft(input: {
    prompt?: string;
    referenceIds?: string[];
  }) {
    await run(async () => {
      if (!project) throw new Error("请先创建或选择目标项目。");
      await state.flush();
      if (!mounted.current) return;
      state.creationDrafts.set(project, input);
      navigate(`/projects/${project}`);
    });
  }
  async function finishReuse(request: ReuseRequest) {
    if (!mounted.current) return;
    state.editors.get(request.project)?.dispose();
    state.editors.delete(request.project);
    // A returning editor must not initialize from the pre-reuse document while
    // an inactive query refreshes. Its new revision is already committed.
    state.queries.removeQueries({
      queryKey: state.key("canvas", request.project),
      exact: true,
    });
    setPendingReuse(null);
    navigate(`/projects/${request.project}`);
  }
  async function reuse(ids: string[]) {
    await run(async () => {
      if (!project) throw new Error("请先创建或选择目标项目。");
      await state.flush();
      let request = pendingReuse;
      if (!request) {
        const latest = await api<CanvasSnapshot>(`/projects/${project}/canvas`);
        if (latest.document.nodes.length + ids.length > 1000)
          throw new Error("画布节点超过 1000 个，请先移除不需要的节点。");
        const nodes = ids.map((id, i) => {
          const asset = allAssets.find((a) => a.id === id),
            index = latest.document.nodes.length + i;
          return {
            id: crypto.randomUUID(),
            kind: "image" as const,
            assetId: id,
            label: "图库图片",
            x: 60 + (index % 4) * 300,
            y: 110 + Math.floor(index / 4) * 340,
            width: 260,
            height: asset
              ? Math.max(60, Math.min(800, (260 * asset.height) / asset.width))
              : 260,
          };
        });
        request = {
          project,
          input: {
            revision: latest.revision,
            requestKey: crypto.randomUUID(),
            document: {
              ...latest.document,
              nodes: [...latest.document.nodes, ...nodes],
            },
            placements: [],
          },
          newIds: nodes.map((n) => n.id),
        };
        setPendingReuse(request);
      }
      try {
        await api(`/projects/${request.project}/canvas`, request.input);
      } catch (e) {
        if (e instanceof ApiError && e.code === "CANVAS_CONFLICT") {
          const current = await api<CanvasSnapshot>(
            `/projects/${request.project}/canvas`,
          );
          if (
            request.newIds.every((id) =>
              current.document.nodes.some((n) => n.id === id),
            )
          ) {
            await finishReuse(request);
            return;
          }
        }
        if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
          setPendingReuse(null);
        throw e;
      }
      await finishReuse(request);
    });
  }
  async function exportImages() {
    await run(async () => {
      const response = await fetch("/api/library/export", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.session.csrfToken,
        },
        body: JSON.stringify({ assetIds: selected }),
      });
      if (!response.ok) {
        const result = await response.json();
        if (result.error?.code === "UNAUTHENTICATED")
          window.dispatchEvent(new Event("tuyile-unauthenticated"));
        throw new ApiError(result.error?.code ?? "INTERNAL_ERROR");
      }
      const blob = await response.blob();
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "tuyile-images.zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("导出文件已准备。");
    });
  }
  const queryError =
    projects.error ||
    assets.error ||
    favorites.error ||
    prompts.error ||
    groups.error;
  const projectPicker = (
    <>
      <ChoiceField
        label="目标项目"
        value={project}
        onValueChange={setTarget}
        disabled={busy || !!pendingReuse}
        options={allProjects.map((p) => ({ value: p.id, label: p.name }))}
      />
      {projects.hasNextPage && (
        <Button disabled={busy} onClick={() => void projects.fetchNextPage()}>
          加载更多目标项目
        </Button>
      )}
      {mode === "prompts" && !project && !projects.isPending && (
        <Link to="/projects">新建项目</Link>
      )}
    </>
  );
  return (
    <section
      className={`library-page${mode === "prompts" ? " prompt-library" : ""}`}
    >
      <div className="page-heading">
        <div>
          <h1>
            {mode === "gallery"
              ? "我的图库"
              : mode === "prompts"
                ? "提示池"
                : "我的收藏"}
          </h1>
        </div>
        {mode === "prompts" && (
          <div className="prompt-project-picker">
            {projectPicker}
            {state.session.user.role === "admin" && (
              <Link to="/admin/prompts">管理提示词</Link>
            )}
          </div>
        )}
      </div>
      {((!editing && error) || queryError) && (
        <Notice error>{error || queryError?.message}</Notice>
      )}
      {message && <Notice>{message}</Notice>}
      {references.length > 0 && (
        <div className="library-references">
          <strong>仍在这些位置使用：</strong>
          {references.map((r, i) => (
            <div key={`${r.kind}-${r.id}-${i}`}>
              {r.projectId ? (
                <Link to={`/projects/${r.projectId}`}>{r.label}</Link>
              ) : (
                <Link to="/favorites">收藏：{r.label}</Link>
              )}
            </div>
          ))}
        </div>
      )}
      {mode !== "prompts" && (
        <div className="library-toolbar">
          {projectPicker}
          <Link to="/projects">管理项目</Link>
          {mode === "gallery" && (
            <>
              <span>已选 {selected.length} 张</span>
              <Button
                disabled={busy || !selected.length}
                onClick={() => void reuse(selected)}
              >
                {pendingReuse ? "重试本次复用" : "加入目标画布"}
              </Button>
              <Button
                disabled={
                  busy ||
                  !!pendingReuse ||
                  selected.length < 1 ||
                  selected.length > 4
                }
                onClick={() =>
                  void openProjectDraft({ referenceIds: selected })
                }
              >
                设为参考图
              </Button>
              <Button
                disabled={
                  busy ||
                  !!pendingReuse ||
                  selected.length < 1 ||
                  selected.length > 5
                }
                onClick={() => void exportImages()}
              >
                导出所选 ZIP
              </Button>
              <HelpPopover title="复用与导出">
                跨项目复用不新增生图计次。参考图最多4张；每批导出最多5张、合计50MiB。
              </HelpPopover>
            </>
          )}
          {mode === "favorites" && (
            <>
              <ChoiceField
                label="收藏分组"
                value={group}
                onValueChange={setGroup}
                options={[
                  { value: "__all__", label: "全部分组" },
                  ...(groups.data?.groups ?? []).map((g) => ({
                    value: `group:${g}`,
                    label: g || "未分组",
                  })),
                ]}
              />
              <Button
                disabled={busy}
                onClick={() =>
                  startFavorite({ title: "我的提示词", prompt: "" })
                }
              >
                新建提示词收藏
              </Button>
            </>
          )}
        </div>
      )}
      <Drawer
        title="编辑收藏"
        open={!!editing}
        size={480}
        destroyOnHidden
        onClose={() => {
          if (!busy && !pendingFavorite.current) setEditing(null);
        }}
        footer={
          <div className="actions">
            <Button
              className="primary"
              type="submit"
              form="favorite-editor"
              disabled={busy || !editing}
            >
              保存收藏
            </Button>
            <Button
              type="button"
              disabled={busy || !!pendingFavorite.current}
              onClick={() => setEditing(null)}
            >
              关闭编辑
            </Button>
          </div>
        }
      >
        {editing && error && <Notice error>{error}</Notice>}
        {editing && (
          <form
            id="favorite-editor"
            className="favorite-editor"
            onSubmit={saveFavorite}
            aria-label="编辑收藏"
          >
            <Field
              label="收藏标题"
              value={editing.title}
              required
              maxLength={100}
              disabled={busy || !!pendingFavorite.current}
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
            />
            <Field
              label="收藏分组名称"
              value={editing.groupName}
              maxLength={60}
              disabled={busy || !!pendingFavorite.current}
              onChange={(e) =>
                setEditing({ ...editing, groupName: e.target.value })
              }
            />
            {editing.prompt !== undefined && (
              <label className="field">
                <span>收藏提示词</span>
                <Input.TextArea
                  aria-label="收藏提示词"
                  value={editing.prompt}
                  rows={4}
                  required
                  maxLength={12000}
                  disabled={busy || !!pendingFavorite.current}
                  onChange={(e) =>
                    setEditing({ ...editing, prompt: e.target.value })
                  }
                />
              </label>
            )}
          </form>
        )}
      </Drawer>
      {mode === "gallery" && (
        <>
          <div className="gallery-grid">
            {allAssets.map((asset) => (
              <article
                className={`gallery-card ${selected.includes(asset.id) ? "is-selected" : ""}`}
                key={asset.id}
              >
                <Checkbox
                  aria-label={`选择图片 ${asset.id}`}
                  checked={selected.includes(asset.id)}
                  disabled={busy || !!pendingReuse}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, asset.id]
                        : old.filter((id) => id !== asset.id),
                    )
                  }
                >
                  <span className="sr-only">选择图片</span>
                </Checkbox>
                <a
                  href={`/api/images/assets/${asset.id}/original`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/api/images/assets/${asset.id}/preview`}
                    alt={`${asset.origin === "upload" ? "上传" : "生成"}图片 ${asset.width} × ${asset.height}`}
                    loading="lazy"
                  />
                </a>
                <div className="gallery-card-title">
                  <strong>
                    {asset.origin === "upload" ? "上传素材" : "生成图片"} ·{" "}
                    {new Date(asset.createdAt).toLocaleDateString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </strong>
                  <span>{asset.mime.replace("image/", "").toUpperCase()}</span>
                </div>
                <p className="hint">
                  {asset.width} × {asset.height} ·{" "}
                  {(asset.bytes / 1048576).toFixed(2)} MiB
                </p>
                <div className="gallery-reuse-actions">
                  <Button
                    className="primary"
                    disabled={busy || !!pendingReuse}
                    onClick={() => void reuse([asset.id])}
                  >
                    加入画布
                  </Button>
                  <Button
                    disabled={busy || !!pendingReuse}
                    onClick={() =>
                      void openProjectDraft({ referenceIds: [asset.id] })
                    }
                  >
                    用作参考
                  </Button>
                </div>
                <div className="gallery-secondary-actions">
                  <a href={`/api/images/assets/${asset.id}/download`}>
                    下载原图
                  </a>
                  <Dropdown
                    autoFocus
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "favorite",
                          label: "收藏图片",
                          disabled: busy || !!pendingReuse,
                          onClick: () =>
                            startFavorite({
                              assetId: asset.id,
                              title: "图片收藏",
                            }),
                        },
                        { type: "divider" },
                        {
                          key: "delete",
                          label: "删除原图",
                          danger: true,
                          disabled: busy || !!pendingReuse,
                          onClick: () => void removeAsset(asset.id),
                        },
                      ],
                    }}
                  >
                    <Button
                      type="button"
                      aria-label="图片更多操作"
                      disabled={busy || !!pendingReuse}
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </Dropdown>
                </div>
              </article>
            ))}
          </div>
          {assets.hasNextPage && (
            <Button disabled={busy} onClick={() => void assets.fetchNextPage()}>
              加载更多图片
            </Button>
          )}
          {!assets.isPending && !allAssets.length && (
            <div className="empty">
              <h2>图库还没有图片</h2>
              <p>上传或生成的图片会保存在这里。</p>
            </div>
          )}
        </>
      )}
      {mode === "prompts" && (
        <div className="prompt-grid">
          {!prompts.isPending && !prompts.error && !allPrompts.length && (
            <div className="empty">暂无提示词</div>
          )}
          {allPrompts.map((p) => (
            <article className="prompt-card" key={p.id}>
              <div className="prompt-card-heading">
                <h2>{p.title}</h2>
                <span className="eyebrow">{p.category}</span>
              </div>
              <Excerpt>{p.prompt}</Excerpt>
              <div className="actions">
                <Button
                  disabled={busy || !project}
                  aria-label="用于目标项目"
                  onClick={() => void openProjectDraft({ prompt: p.prompt })}
                >
                  使用 <ArrowRight size={14} aria-hidden="true" />
                </Button>
                <Tooltip title="收藏">
                  <Button
                    className="prompt-bookmark"
                    aria-label="收藏提示词"
                    disabled={busy}
                    onClick={() =>
                      startFavorite({
                        title: p.title,
                        prompt: p.prompt,
                        groupName: p.category,
                      })
                    }
                  >
                    <Bookmark size={16} aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            </article>
          ))}
          {prompts.hasNextPage && (
            <Button
              type="button"
              loading={prompts.isFetchingNextPage}
              disabled={prompts.isFetchingNextPage}
              onClick={() => void prompts.fetchNextPage()}
            >
              加载更多提示词
            </Button>
          )}
        </div>
      )}
      {mode === "favorites" && (
        <>
          <div className="prompt-grid">
            {favorites.data?.pages
              .flatMap((p) => p.favorites)
              .map((f) => (
                <article className="prompt-card favorite-card" key={f.id}>
                  <span className="eyebrow">{f.groupName || "未分组"}</span>
                  <h2>{f.title}</h2>
                  {f.assetId ? (
                    <img
                      src={`/api/images/assets/${f.assetId}/preview`}
                      alt={f.title}
                    />
                  ) : (
                    <Excerpt>{f.prompt!}</Excerpt>
                  )}
                  <div className="actions">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        f.assetId
                          ? void reuse([f.assetId])
                          : void openProjectDraft({ prompt: f.prompt })
                      }
                    >
                      用于目标项目
                    </Button>
                    {f.assetId && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void openProjectDraft({ referenceIds: [f.assetId!] })
                        }
                      >
                        作为参考图
                      </Button>
                    )}
                    <Button
                      disabled={busy || !!pendingReuse}
                      onClick={() => startFavorite(f)}
                    >
                      编辑收藏
                    </Button>
                    <Button
                      disabled={busy || !!pendingReuse}
                      onClick={() => void removeFavorite(f.id)}
                    >
                      移除收藏
                    </Button>
                  </div>
                </article>
              ))}
          </div>
          {favorites.hasNextPage && (
            <Button
              disabled={busy}
              onClick={() => void favorites.fetchNextPage()}
            >
              加载更多收藏
            </Button>
          )}
          {!favorites.isPending &&
            !favorites.data?.pages.some((p) => p.favorites.length) && (
              <div className="empty">这个分组还没有收藏。</div>
            )}
        </>
      )}
    </section>
  );
}
