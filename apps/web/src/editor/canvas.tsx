import {
  useEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
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
} from "@tuyile/ui";
import { useNavigate } from "react-router-dom";
import { EditorStore } from "./store";
import { GenerationFeedback } from "../generation-feedback";
import { useSessionState } from "../session-state";
import { client, ApiError } from "../api";
type ImageNode = Node<
  {
    label: string;
    assetId?: string;
    reference?: (id: string) => void;
    reuse?: () => void;
  },
  "image"
>;
function ImageCard({ data, selected }: NodeProps<ImageNode>) {
  const [preview, setPreview] = useState(false);
  return (
    <div
      className="canvas-image"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setPreview(true);
      }}
    >
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
      <div className="canvas-image-heading" title={data.label}>
        {data.label}
      </div>
      <img
        draggable={false}
        src={`/api/images/assets/${data.assetId}/preview`}
        alt={data.label}
      />
      <div className="canvas-image-caption">
        <span title={data.label}>{data.label}</span>
        <a
          className="nodrag"
          href={`/api/images/assets/${data.assetId}/download`}
        >
          下载原图
        </a>
        {selected && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "preview", label: "查看原图" },
                ...(data.reuse ? [{ key: "reuse", label: "复用设置" }] : []),
              ],
              onClick: ({ key }) =>
                key === "preview" ? setPreview(true) : data.reuse?.(),
            }}
          >
            <Button type="button" className="nodrag" aria-label="图片操作">
              ···
            </Button>
          </Dropdown>
        )}
        {selected && (
          <Button
            className="nodrag"
            onClick={() => data.reference?.(data.assetId!)}
          >
            作为参考图
          </Button>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
function GroupCard({ data, selected }: NodeProps) {
  return (
    <div className="canvas-group">
      <NodeResizer isVisible={selected} minWidth={120} minHeight={120} />
      <span>{String(data.label)}</span>
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
}: {
  tasks: ImageTask[];
  projectId: string;
  onReference: (id: string) => void;
  onSelectionChange?: (assets: { id: string; name: string }[]) => void;
  onReuse?: (task: ImageTask) => void;
  statusStale?: boolean;
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
}: {
  tasks: ImageTask[];
  store: EditorStore;
  projectId: string;
  onReference: (id: string) => void;
  onSelectionChange?: (assets: { id: string; name: string }[]) => void;
  onReuse?: (task: ImageTask) => void;
  statusStale?: boolean;
}) {
  const state = useSessionState(),
    snap = useSyncExternalStore(store.subscribe, store.get),
    confirm = useConfirm(),
    navigate = useNavigate();
  const api = client(state.session.csrfToken);
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
    [snap.document, snap.selected, onReference, onReuse, tasks],
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
      const ids = new Map(
        old
          .filter((n) => selected.has(n.id) || selected.has(n.parentId ?? ""))
          .map((n) => [n.id, crypto.randomUUID()]),
      );
      next = [
        ...old,
        ...old
          .filter((n) => ids.has(n.id))
          .map((n) => ({
            ...n,
            id: ids.get(n.id)!,
            parentId: n.parentId ? ids.get(n.parentId) : undefined,
            x: n.x + 30,
            y: n.y + 30,
          })),
      ];
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
      className={`canvas-surface${panning ? " is-panning" : ""}`}
      aria-label="项目画布"
    >
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
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest("input,textarea,button"))
            return;
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            command("remove");
          }
          if ((e.ctrlKey || e.metaKey) && e.key === "z") {
            e.preventDefault();
            e.shiftKey ? store.redo() : store.undo();
          }
        }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {tasks.some(
        (t) => ["queued", "running"].includes(t.state) || t.pendingReview,
      ) && (
        <div className="canvas-generation-status">
          <GenerationFeedback compact tasks={tasks} stale={statusStale} />
        </div>
      )}
      <div className="canvas-toolbar" role="toolbar" aria-label="画布操作">
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
        <Tooltip title="小手" trigger={["hover", "focus"]}>
          <Button
            type="button"
            aria-label="小手工具"
            aria-pressed={handMode}
            onClick={() => {
              store.select([]);
              setHandMode(true);
            }}
          >
            <Hand size={16} />
          </Button>
        </Tooltip>

        <Tooltip title="撤销" trigger={["hover", "focus"]}>
          <Button
            aria-label="撤销"
            disabled={!snap.canUndo}
            onClick={() => store.undo()}
          >
            <Undo2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="重做" trigger={["hover", "focus"]}>
          <Button
            aria-label="重做"
            disabled={!snap.canRedo}
            onClick={() => store.redo()}
          >
            <Redo2 size={16} />
          </Button>
        </Tooltip>
        <Tooltip title="复制" trigger={["hover", "focus"]}>
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
