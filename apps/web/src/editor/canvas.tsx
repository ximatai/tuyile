import { DemoImageDetails } from "../demo";
import {
  useEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  NodeToolbar,
  useViewport,
  useStore,
  useKeyPress,
  Background,
  Controls,
  NodeResizer,
  Handle,
  Position,
  type Node,
  type NodeProps,
  type NodeChange,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  ImageTask,
  CanvasNode,
  CanvasSnapshot,
  CanvasOutput,
  CanvasSources,
  Project,
} from "@tuyile/contracts";
import {
  FileText,
  Upload as UploadIcon,
  MoreHorizontal,
  Expand,
  Download,
  ImagePlus,
  SlidersHorizontal,
  Hand,
  MousePointer2,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Group,
  Ungroup,
  AlignStartVertical,
} from "lucide-react";
import {
  Button,
  Dropdown,
  Image,
  Notice,
  Tooltip,
  useConfirm,
  Upload,
  Input,
} from "@tuyile/ui";
import { useNavigate } from "react-router-dom";
import { EditorStore } from "./store";
import { GenerationFeedback } from "../generation-feedback";
import { useSessionState } from "../session-state";
import { client, ApiError } from "../api";
const canvasClipboardType = "application/x-tuyile-canvas";
const canvasClipboardPrefix = "Tuyile canvas:";
function canvasEventTarget(surface: HTMLElement, target: EventTarget | null) {
  return (
    target instanceof Element &&
    surface.contains(target) &&
    !target.closest(
      "input,textarea,select,button,a,[contenteditable],[role=dialog],[role=menu],[role=combobox]",
    )
  );
}
function nativeModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
  return /Mac|iPhone|iPad/.test(navigator.platform)
    ? event.metaKey
    : event.ctrlKey;
}
type ImageNode = Node<
  {
    label: string;
    rename: (label: string) => void;
    assetId?: string;
    reference?: (id: string) => void;
    reuse?: () => void;
    info?: () => void;
  },
  "image"
>;
function NodeTitle({
  label,
  kind,
  onRename,
  className = "",
}: {
  label: string;
  kind: "图片" | "分组";
  onRename: (label: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const active = useRef(false);
  const composing = useRef(false);
  const input = useRef<ComponentRef<typeof Input>>(null);
  const title = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus({ cursor: "all", preventScroll: true });
  }, [editing]);
  function start() {
    active.current = true;
    composing.current = false;
    setValue(label);
    setEditing(true);
  }
  function finish(save: boolean, restoreFocus = false) {
    if (!active.current) return;
    active.current = false;
    composing.current = false;
    if (save) onRename(value);
    setEditing(false);
    if (restoreFocus)
      requestAnimationFrame(() =>
        title.current?.focus({ preventScroll: true }),
      );
  }
  return (
    <span
      data-canvas-title
      className={`canvas-node-title ${className} nodrag nopan nowheel${editing ? " is-editing" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {editing ? (
        <Input
          ref={input}
          variant="borderless"
          aria-label={kind === "图片" ? "图片名称" : "分组标题"}
          maxLength={100}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => finish(true)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (
              event.nativeEvent.isComposing ||
              composing.current ||
              event.keyCode === 229
            )
              return;
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              finish(event.key === "Enter", true);
            }
          }}
        />
      ) : (
        <span
          ref={title}
          role="button"
          tabIndex={0}
          className="canvas-node-title-display"
          aria-label={`重命名${kind}：${label || "未命名"}`}
          title={`${label || "未命名"}（双击重命名）`}
          onDoubleClick={start}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              event.stopPropagation();
              start();
            }
          }}
        >
          {label || "未命名"}
        </span>
      )}
    </span>
  );
}
function ImageCard({
  id,
  data,
  selected,
  width = 260,
  height = 260,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<ImageNode>) {
  const [preview, setPreview] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const viewport = useViewport();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const compact = width * viewport.zoom < 160 || height * viewport.zoom < 48;
  const actionCount =
    2 + Number(!!data.reference) + Number(!!data.reuse) + Number(!!data.info);
  const toolbarWidth = compact ? 28 : actionCount * 28 + (actionCount - 1) * 4;
  const right = (positionAbsoluteX + width) * viewport.zoom + viewport.x;
  const left = right - 8 - toolbarWidth;
  const horizontalInset =
    -8 + Math.max(0, 8 - left) - Math.max(0, right - 8 - (canvasWidth - 8));
  const top = positionAbsoluteY * viewport.zoom + viewport.y;
  const bottom = top + height * viewport.zoom;
  const onScreen =
    right > 0 &&
    right - width * viewport.zoom < canvasWidth &&
    bottom > 0 &&
    top < canvasHeight;
  const desiredTop = top + 8;
  const toolbarTop = Math.max(8, Math.min(desiredTop, canvasHeight - 36));
  const toolbarOffset = top - 28 - toolbarTop;
  useEffect(() => setMenuOpen(false), [compact, onScreen]);

  return (
    <div
      className="canvas-image"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setPreview(true);
      }}
    >
      <NodeTitle
        label={data.label}
        kind="图片"
        onRename={data.rename}
        className="canvas-image-caption"
      />
      <Image.PreviewGroup
        items={[`/api/images/assets/${data.assetId}/original`]}
        preview={{ open: preview, onOpenChange: setPreview, motionName: "" }}
      />
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={80}
        keepAspectRatio
      />
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <img
        draggable={false}
        src={`/api/images/assets/${data.assetId}/preview`}
        alt={data.label}
      />
      <NodeToolbar
        nodeId={id}
        isVisible={onScreen}
        position={Position.Top}
        align="end"
        offset={toolbarOffset}
        style={{ marginLeft: horizontalInset }}
        className={`canvas-image-actions nodrag nopan${hovered || selected || (compact && menuOpen) ? " is-visible" : ""}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="toolbar"
        aria-label="图片操作"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {compact ? (
          <Dropdown
            trigger={["click"]}
            transitionName=""
            destroyOnHidden
            open={menuOpen}
            onOpenChange={setMenuOpen}
            menu={{
              items: [
                ...(data.info
                  ? [
                      {
                        key: "info",
                        icon: <FileText size={16} />,
                        label: "查看示例提示词",
                      },
                    ]
                  : []),
                { key: "preview", icon: <Expand size={16} />, label: "预览" },
                {
                  key: "download",
                  icon: <Download size={16} />,
                  label: (
                    <a href={`/api/images/assets/${data.assetId}/download`}>
                      下载原图
                    </a>
                  ),
                },
                ...(data.reference
                  ? [
                      {
                        key: "reference",
                        icon: <ImagePlus size={16} />,
                        label: "作为参考图",
                      },
                    ]
                  : []),
                ...(data.reuse
                  ? [
                      {
                        key: "reuse",
                        icon: <SlidersHorizontal size={16} />,
                        label: "复用设置",
                      },
                    ]
                  : []),
              ],
              onClick: ({ key }) => {
                setMenuOpen(false);
                if (key === "info") data.info?.();
                if (key === "preview") setPreview(true);
                if (key === "reference") data.reference?.(data.assetId!);
                if (key === "reuse") data.reuse?.();
              },
            }}
          >
            <Button
              type="button"
              aria-label="更多图片操作"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
          </Dropdown>
        ) : (
          <>
            {data.info && (
              <Tooltip title="示例提示词" trigger={["hover", "focus"]}>
                <Button
                  type="button"
                  aria-label="查看示例提示词"
                  onClick={data.info}
                >
                  <FileText size={16} />
                </Button>
              </Tooltip>
            )}
            <Tooltip title="预览" trigger={["hover", "focus"]}>
              <Button
                type="button"
                aria-label="查看原图"
                onClick={() => setPreview(true)}
              >
                <Expand size={16} aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip title="下载" trigger={["hover", "focus"]}>
              <a
                className="canvas-image-action"
                aria-label="下载原图"
                href={`/api/images/assets/${data.assetId}/download`}
              >
                <Download size={16} aria-hidden="true" />
              </a>
            </Tooltip>
            {data.reference && (
              <Tooltip title="参考图" trigger={["hover", "focus"]}>
                <Button
                  type="button"
                  aria-label="作为参考图"
                  onClick={() => data.reference?.(data.assetId!)}
                >
                  <ImagePlus size={16} aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
            {data.reuse && (
              <Tooltip title="复用" trigger={["hover", "focus"]}>
                <Button
                  type="button"
                  aria-label="复用图片设置"
                  onClick={() => data.reuse?.()}
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </NodeToolbar>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
function GroupCard({
  data,
  selected,
}: NodeProps<
  Node<{ label: string; rename: (label: string) => void }, "group">
>) {
  return (
    <div className="canvas-group">
      <NodeResizer isVisible={selected} minWidth={120} minHeight={120} />
      <NodeTitle label={data.label} kind="分组" onRename={data.rename} />
    </div>
  );
}
const nodeTypes = { image: ImageCard, group: GroupCard };
export function CanvasEditor({
  projectId,
  onReference,
  onSelectionChange,
  onReuse,
  tasks,
  statusStale,
  onUpload,
  uploadBusy,
}: {
  tasks: ImageTask[];
  projectId: string;
  onReference: (id: string) => void;
  onSelectionChange?: (assets: { id: string; name: string }[]) => void;
  onReuse?: (task: ImageTask) => void;
  statusStale?: boolean;
  onUpload: (files: File[]) => void;
  uploadBusy: boolean;
}) {
  const state = useSessionState();
  const api = client(state.session.csrfToken);
  const initial = useQuery({
    queryKey: state.key("canvas", projectId),
    queryFn: ({ signal }) =>
      api<CanvasSnapshot>(`/projects/${projectId}/canvas`, undefined, signal),
    staleTime: Infinity,
  });
  const [store, setStore] = useState<EditorStore>();
  useEffect(() => {
    if (!initial.data) return;
    let editor = state.editors.get(projectId);
    if (!editor) {
      editor = new EditorStore(initial.data, (input) =>
        api<CanvasSnapshot>(`/projects/${projectId}/canvas`, input),
      );
      state.editors.set(projectId, editor);
    }
    setStore(editor);
  }, [initial.data, projectId, state]);
  if (initial.error) return <Notice error>{initial.error.message}</Notice>;
  return store ? (
    <CanvasView
      key={projectId}
      store={store}
      tasks={tasks}
      projectId={projectId}
      onReference={onReference}
      onSelectionChange={onSelectionChange}
      onReuse={onReuse}
      statusStale={statusStale}
      onUpload={onUpload}
      uploadBusy={uploadBusy}
    />
  ) : (
    <p role="status">正在打开画布…</p>
  );
}
function CanvasView({
  store,
  projectId,
  onReference,
  onSelectionChange,
  onReuse,
  tasks,
  statusStale,
  onUpload,
  uploadBusy,
}: {
  tasks: ImageTask[];
  store: EditorStore;
  projectId: string;
  onReference: (id: string) => void;
  onSelectionChange?: (assets: { id: string; name: string }[]) => void;
  onReuse?: (task: ImageTask) => void;
  statusStale?: boolean;
  onUpload: (files: File[]) => void;
  uploadBusy: boolean;
}) {
  const state = useSessionState(),
    snap = useSyncExternalStore(store.subscribe, store.get),
    confirm = useConfirm(),
    navigate = useNavigate();
  const api = client(state.session.csrfToken);
  const demo = useQuery({
    queryKey: state.key("project-demo", projectId),
    queryFn: ({ signal }) =>
      api<import("@tuyile/contracts").ProjectDemo | null>(
        `/projects/${projectId}/demo`,
        undefined,
        signal,
      ),
  });
  const [example, setExample] = useState<
    import("@tuyile/contracts").DemoImage | null
  >(null);
  const outputs = useQuery({
    queryKey: state.key("canvas-outputs", projectId),
    queryFn: ({ signal }) =>
      api<{ revision: number; outputs: CanvasOutput[] }>(
        `/projects/${projectId}/canvas/outputs`,
        undefined,
        signal,
      ),
    refetchInterval: 1500,
  });
  const sources = useQuery({
    queryKey: state.key("canvas-sources", projectId, String(snap.revision)),
    queryFn: ({ signal }) =>
      api<CanvasSources[]>(
        `/projects/${projectId}/canvas/sources`,
        undefined,
        signal,
      ),
  });
  useEffect(() => {
    if (
      outputs.data &&
      !snap.conflict &&
      outputs.data.revision >= snap.revision
    )
      store.place(outputs.data.outputs);
  }, [outputs.data, store, snap.conflict, snap.revision]);
  useEffect(() => {
    const selected = snap.document.nodes.filter(
      (n) => snap.selected.includes(n.id) && n.kind === "image" && n.assetId,
    );
    onSelectionChange?.([
      ...new Map(
        selected.map((n) => [
          n.assetId!,
          { id: n.assetId!, name: n.label || "画布参考图" },
        ]),
      ).values(),
    ]);
  }, [snap.document, snap.selected, onSelectionChange]);
  const [handMode, setHandMode] = useState(false);
  const spacePressed = useKeyPress("Space");
  const panning = handMode || spacePressed;
  const [operationError, setOperationError] = useState("");
  const [fileDrag, setFileDrag] = useState(false);
  function importFiles(files: File[]) {
    if (!files.length || files.length > 20) {
      setOperationError("每次可导入 1–20 张图片。");
      return;
    }
    if (uploadBusy) {
      setOperationError("正在处理上传或提交，请稍后再导入图片。");
      return;
    }
    try {
      store.canAddImage(files.length);
    } catch (error) {
      setOperationError((error as Error).message);
      return;
    }
    setOperationError("");
    onUpload(files);
  }
  function pasteNodes() {
    try {
      store.pasteSelection();
      setOperationError("");
    } catch (error) {
      setOperationError((error as Error).message);
    }
  }
  const [copyMessage, setCopyMessage] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const copying = useRef(false);
  const [copyRequest, setCopyRequest] =
    useState<ReturnType<EditorStore["copyInput"]>>();
  const display = useMemo<Node[]>(
    () =>
      [...snap.document.nodes]
        .sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId))
        .map((n) => {
          const parent = snap.document.nodes.find((p) => p.id === n.parentId);
          return {
            id: n.id,
            type: n.kind,
            parentId: n.parentId,
            position: { x: n.x - (parent?.x ?? 0), y: n.y - (parent?.y ?? 0) },
            width: n.width,
            height: n.height,
            style: { width: n.width, height: n.height },
            selected: snap.selected.includes(n.id),
            data: {
              label: n.label,
              rename: (label: string) => store.renameNode(n.id, label),
              info: demo.data?.images.some((i) => i.assetId === n.assetId)
                ? () =>
                    setExample(
                      demo.data!.images.find((i) => i.assetId === n.assetId)!,
                    )
                : undefined,
              assetId: n.assetId,
              reference: onReference,
              reuse:
                onReuse &&
                tasks.some(
                  (t) =>
                    !t.pendingReview &&
                    !["queued", "running"].includes(t.state) &&
                    t.settings &&
                    t.outputs.some((a) => a.id === n.assetId),
                )
                  ? () => {
                      const task = tasks.find(
                        (t) =>
                          t.settings &&
                          t.outputs.some((a) => a.id === n.assetId),
                      );
                      if (task) onReuse(task);
                    }
                  : undefined,
            },
          };
        }),
    [
      snap.document,
      snap.selected,
      onReference,
      onReuse,
      tasks,
      store,
      demo.data,
    ],
  );
  const [nodes, setNodes] = useState<Node[]>(display);
  useEffect(
    () =>
      setNodes((current) =>
        display.map((n) => ({
          ...current.find((old) => old.id === n.id),
          ...n,
        })),
      ),
    [display],
  );
  const edges = useMemo(() => {
    const relations = [
      ...(sources.data ?? []),
      ...(outputs.data?.outputs ?? []).map((o) => ({
        assetId: o.assetId,
        sourceIds: o.sourceIds,
      })),
    ];
    return relations
      .flatMap((r) =>
        snap.document.nodes
          .filter((n) => n.assetId === r.assetId)
          .flatMap((target) =>
            snap.document.nodes
              .filter((n) => n.assetId && r.sourceIds.includes(n.assetId))
              .map((source) => ({
                id: `${source.id}-${target.id}`,
                source: source.id,
                target: target.id,
                label: "来源",
                selectable: false,
                style: { stroke: "#7ca8cf" },
              })),
          ),
      )
      .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
  }, [sources.data, outputs.data, snap.document]);
  function changes(changes: NodeChange[]) {
    changes = changes.filter((c) => !("id" in c) || !c.id.startsWith("task-"));
    if (!changes.length) return;
    setNodes((current) => applyNodeChanges(changes, current));
    const selection = changes.filter((c) => c.type === "select");
    if (selection.length) {
      const selected = new Set(snap.selected);
      for (const c of selection) {
        if (c.type === "select")
          c.selected ? selected.add(c.id) : selected.delete(c.id);
      }
      store.select([...selected]);
    }
    if (
      changes.some(
        (c) =>
          (c.type === "position" && c.dragging === false) ||
          (c.type === "dimensions" && c.resizing === false),
      )
    ) {
      const changed = applyNodeChanges(changes, nodes);
      const byId = new Map(changed.map((n) => [n.id, n]));
      function absolute(n: Node): { x: number; y: number } {
        const parent = n.parentId ? byId.get(n.parentId) : undefined;
        const offset = parent ? absolute(parent) : { x: 0, y: 0 };
        return { x: n.position.x + offset.x, y: n.position.y + offset.y };
      }
      store.edit({
        ...snap.document,
        nodes: snap.document.nodes.map((n) => {
          const flow = byId.get(n.id);
          return flow
            ? {
                ...n,
                ...absolute(flow),
                width: flow.width ?? n.width,
                height: flow.height ?? n.height,
              }
            : n;
        }),
      });
    }
  }
  function command(action: "remove" | "copy" | "group" | "ungroup" | "align") {
    const selected = new Set(snap.selected),
      old = snap.document.nodes;
    let next: CanvasNode[] = old;
    if (action === "remove")
      next = old
        .filter((n) => !selected.has(n.id))
        .map((n) =>
          selected.has(n.parentId ?? "") ? { ...n, parentId: undefined } : n,
        );
    if (action === "copy") {
      try {
        store.duplicateSelection();
        setOperationError("");
      } catch (e) {
        setOperationError((e as Error).message);
      }
      return;
    }
    if (action === "group") {
      const picked = old.filter(
        (n) => selected.has(n.id) && n.kind === "image",
      );
      if (picked.length < 2) return;
      const x = Math.min(...picked.map((n) => n.x)) - 25,
        y = Math.min(...picked.map((n) => n.y)) - 40,
        id = crypto.randomUUID();
      next = [
        ...old.map((n) => (picked.includes(n) ? { ...n, parentId: id } : n)),
        {
          id,
          kind: "group",
          label: "图片分组",
          x,
          y,
          width: Math.max(...picked.map((n) => n.x + n.width)) - x + 25,
          height: Math.max(...picked.map((n) => n.y + n.height)) - y + 25,
        },
      ];
    }
    if (action === "ungroup") {
      const groups = new Set(
        old
          .filter((n) => selected.has(n.id) || selected.has(n.parentId ?? ""))
          .flatMap((n) =>
            n.kind === "group" ? [n.id] : n.parentId ? [n.parentId] : [],
          ),
      );
      next = old
        .filter((n) => !groups.has(n.id))
        .map((n) =>
          groups.has(n.parentId ?? "") ? { ...n, parentId: undefined } : n,
        );
    }
    if (action === "align") {
      const picked = old.filter(
        (n) => selected.has(n.id) && n.kind === "image",
      );
      if (picked.length < 2) return;
      const x = Math.min(...picked.map((n) => n.x));
      next = old.map((n) => (picked.includes(n) ? { ...n, x } : n));
    }
    store.edit({ ...snap.document, nodes: next });
  }
  async function reload() {
    if (!(await confirm("重新加载将放弃本地尚未保存的画布修改。"))) return;
    setOperationError("");
    setCopyMessage("");
    try {
      const latest = await api<CanvasSnapshot>(`/projects/${projectId}/canvas`);
      store.reset(latest);
      await state.queries.invalidateQueries({
        queryKey: state.key("canvas-outputs", projectId),
      });
    } catch (e) {
      setOperationError((e as Error).message);
    }
  }
  async function copy() {
    if (copying.current) return;
    copying.current = true;
    setCopyBusy(true);
    setCopyMessage("");
    setOperationError("");
    const input = copyRequest ?? store.copyInput();
    setCopyRequest(input);
    try {
      const project = await api<Project>(
        `/projects/${projectId}/canvas/copy`,
        input,
      ).catch((error) => {
        // A rejected transaction created no copy. A network/unknown response may have committed.
        if (error instanceof ApiError && error.code !== "INTERNAL_ERROR")
          setCopyRequest(undefined);
        throw error;
      });
      const latest = await api<CanvasSnapshot>(`/projects/${projectId}/canvas`);
      await state.queries.invalidateQueries({
        queryKey: state.key("projects"),
      });
      if (state.editors.get(projectId) !== store) return;
      setCopyRequest(undefined);
      if (store.get().document !== input.document) {
        setCopyMessage(
          "副本已保存；等待期间的新修改仍保留在当前画布，请再次另存以保存这些修改。",
        );
        return;
      }
      store.reset(latest);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setOperationError((e as Error).message);
    } finally {
      copying.current = false;
      setCopyBusy(false);
    }
  }

  return (
    <section
      className={`canvas-surface${panning ? " is-panning" : ""}${fileDrag ? " is-file-drag" : ""}`}
      aria-label="项目画布"
      tabIndex={0}
      onDragEnter={(e) => {
        if (
          !e.currentTarget.contains(e.target as globalThis.Node) ||
          !e.dataTransfer.types.includes("Files")
        )
          return;
        e.preventDefault();
        setFileDrag(true);
      }}
      onDragOver={(e) => {
        if (
          !e.currentTarget.contains(e.target as globalThis.Node) ||
          !e.dataTransfer.types.includes("Files")
        )
          return;
        e.preventDefault();
        e.dataTransfer.dropEffect =
          uploadBusy || snap.conflict || snap.document.nodes.length >= 1000
            ? "none"
            : "copy";
      }}
      onDragLeave={(e) => {
        if (
          !(e.relatedTarget instanceof window.Node) ||
          !e.currentTarget.contains(e.relatedTarget)
        )
          setFileDrag(false);
      }}
      onDrop={(e) => {
        if (
          !e.currentTarget.contains(e.target as globalThis.Node) ||
          !e.dataTransfer.types.includes("Files")
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        setFileDrag(false);
        if (!canvasEventTarget(e.currentTarget, e.target)) return;
        e.currentTarget.focus({ preventScroll: true });
        importFiles(Array.from(e.dataTransfer.files));
      }}
      onCopy={(e) => {
        if (
          e.defaultPrevented ||
          !canvasEventTarget(e.currentTarget, e.target) ||
          !store.copySelection()
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const key = store.copiedSelectionKey();
        e.clipboardData.setData(canvasClipboardType, key);
        e.clipboardData.setData("text/plain", `${canvasClipboardPrefix}${key}`);
      }}
      onPaste={(e) => {
        if (e.defaultPrevented || !canvasEventTarget(e.currentTarget, e.target))
          return;
        const key =
          e.clipboardData.getData(canvasClipboardType) ||
          e.clipboardData.getData("text/plain").replace(/^Tuyile canvas:/, "");
        const files = Array.from(e.clipboardData.files);
        if (store.matchesCopiedSelection(key)) {
          e.preventDefault();
          e.stopPropagation();
          pasteNodes();
        } else if (files.length) {
          e.preventDefault();
          e.stopPropagation();
          importFiles(files);
        }
      }}
      onPointerDownCapture={(e) => {
        if (
          e.target instanceof Element &&
          e.target.closest("[data-canvas-title]")
        )
          return;
        if (!canvasEventTarget(e.currentTarget, e.target)) return;
        e.currentTarget.focus({ preventScroll: true });
      }}
      onKeyDown={(e) => {
        if (
          e.defaultPrevented ||
          e.nativeEvent.isComposing ||
          !canvasEventTarget(e.currentTarget, e.target)
        )
          return;
        const key = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;
        if (e.altKey) return;
        // Native copy/paste events expose clipboard data without requesting read permissions.
        if (
          mod &&
          !e.shiftKey &&
          (key === "c" || key === "v") &&
          nativeModifier(e)
        ) {
          if (e.repeat) e.preventDefault();
          e.stopPropagation();
          return;
        }
        const action =
          mod && !e.shiftKey
            ? {
                a: () => store.selectAll(),
                c: () => {
                  store.copySelection();
                },
                v: () => store.pasteSelection(),
                d: () => store.duplicateSelection(),
                z: () => store.undo(),
              }[key]
            : mod && e.shiftKey && key === "z"
              ? () => store.redo()
              : !mod && !e.shiftKey && (key === "delete" || key === "backspace")
                ? () => command("remove")
                : !mod && !e.shiftKey && key === "escape"
                  ? () => store.select([])
                  : undefined;
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        try {
          action();
          setOperationError("");
        } catch (error) {
          setOperationError((error as Error).message);
        }
      }}
    >
      <DemoImageDetails image={example} onClose={() => setExample(null)} />
      {fileDrag && (
        <div className="canvas-file-drop-hint" role="status">
          松开以将图片上传到画布（每批最多20张）
        </div>
      )}
      <div className="canvas-status" role="status">
        {snap.saving ? "正在保存…" : snap.dirty ? "有未保存修改" : "画布已保存"}{" "}
        · v{snap.revision}
      </div>
      {copyMessage && (
        <div className="canvas-copy-message">
          <Notice>{copyMessage}</Notice>
        </div>
      )}
      {(snap.error || operationError || outputs.error) && (
        <div className="canvas-error">
          <Notice error>
            {operationError || snap.error || outputs.error?.message}
          </Notice>
          {snap.error && (
            <div className="actions">
              <Button
                onClick={() => void store.flush().catch(() => {})}
                disabled={snap.conflict}
              >
                重试保存
              </Button>
              <Button disabled={copyBusy} onClick={() => void reload()}>
                重新加载
              </Button>
              <Button disabled={copyBusy} onClick={() => void copy()}>
                另存副本
              </Button>
            </div>
          )}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={changes}
        defaultViewport={snap.document.viewport}
        onMoveEnd={(_, viewport) =>
          store.edit({ ...store.get().document, viewport })
        }
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={4}
        nodesDraggable={!panning}
        elementsSelectable={!panning}
        selectionOnDrag={false}
        selectionKeyCode={panning ? null : "Shift"}
        panActivationKeyCode="Space"
        panOnDrag={[0, 1, 2]}
        onPaneClick={() => store.select([])}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {(tasks.some((t) => ["queued", "running"].includes(t.state)) ||
        tasks[0]?.pendingReview) && (
        <div className="canvas-generation-status">
          <GenerationFeedback compact tasks={tasks} stale={statusStale} />
        </div>
      )}
      <div className="canvas-toolbar" role="toolbar" aria-label="画布操作">
        <Upload
          multiple
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          disabled={
            uploadBusy || snap.conflict || snap.document.nodes.length >= 1000
          }
          beforeUpload={(file, files) => {
            if (file.uid === files[0]?.uid) importFiles(files);
            return Upload.LIST_IGNORE;
          }}
        >
          <Tooltip title="上传图片到画布" trigger={["hover", "focus"]}>
            <Button
              type="button"
              aria-label="上传图片到画布"
              loading={uploadBusy}
              disabled={
                uploadBusy ||
                snap.conflict ||
                snap.document.nodes.length >= 1000
              }
            >
              <UploadIcon size={16} />
            </Button>
          </Tooltip>
        </Upload>

        <Tooltip title="选择" trigger={["hover", "focus"]}>
          <Button
            type="button"
            aria-label="选择工具"
            aria-pressed={!handMode}
            onClick={() => setHandMode(false)}
          >
            <MousePointer2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="拖拽" trigger={["hover", "focus"]}>
          <Button
            type="button"
            aria-label="拖拽工具"
            aria-pressed={handMode}
            onClick={() => {
              store.select([]);
              setHandMode(true);
            }}
          >
            <Hand size={16} />
          </Button>
        </Tooltip>

        <Tooltip title="撤销（⌘/Ctrl+Z）" trigger={["hover", "focus"]}>
          <Button
            aria-label="撤销"
            disabled={!snap.canUndo}
            onClick={() => store.undo()}
          >
            <Undo2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="重做（⌘/Ctrl+Shift+Z）" trigger={["hover", "focus"]}>
          <Button
            aria-label="重做"
            disabled={!snap.canRedo}
            onClick={() => store.redo()}
          >
            <Redo2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="创建副本（⌘/Ctrl+D）" trigger={["hover", "focus"]}>
          <Button
            aria-label="复制"
            disabled={!snap.selected.length}
            onClick={() => command("copy")}
          >
            <Copy size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="移除节点" trigger={["hover", "focus"]}>
          <Button
            aria-label="移除节点"
            disabled={!snap.selected.length}
            onClick={() => command("remove")}
          >
            <Trash2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="分组" trigger={["hover", "focus"]}>
          <Button
            aria-label="分组"
            disabled={snap.selected.length < 2}
            onClick={() => command("group")}
          >
            <Group size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="解除分组" trigger={["hover", "focus"]}>
          <Button
            aria-label="解除分组"
            disabled={!snap.selected.length}
            onClick={() => command("ungroup")}
          >
            <Ungroup size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="左对齐" trigger={["hover", "focus"]}>
          <Button
            aria-label="左对齐"
            disabled={snap.selected.length < 2}
            onClick={() => command("align")}
          >
            <AlignStartVertical size={16} />
          </Button>
        </Tooltip>
      </div>
    </section>
  );
}
