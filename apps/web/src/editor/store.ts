import {
  canvasDocument,
  type CanvasDocument,
  type CanvasSnapshot,
  type CanvasSave,
  type CanvasOutput,
  type CanvasNode,
} from "@tuyile/contracts";
function imagePosition(
  nodes: CanvasNode[],
  viewport: CanvasDocument["viewport"],
  width: number,
  height: number,
) {
  const anchorX = Math.max(
    -99000,
    Math.min(99000, (60 - viewport.x) / viewport.zoom),
  );
  const anchorY = Math.max(
    -99000,
    Math.min(99000, (70 - viewport.y) / viewport.zoom),
  );
  const rows = [...new Set([anchorY, ...nodes.map((n) => n.y + n.height + 24)])]
    .filter((y) => y >= anchorY && y <= 100000)
    .sort((a, b) => a - b);
  let position: { x: number; y: number } | undefined;
  for (const y of rows) {
    for (let column = 0; column < 3; column++) {
      const x = anchorX + column * (width + 24);
      if (
        !nodes.some(
          (n) =>
            x < n.x + n.width + 24 &&
            x + width + 24 > n.x &&
            y < n.y + n.height + 24 &&
            y + height + 24 > n.y,
        )
      ) {
        position = { x, y };
        break;
      }
    }
    if (position) break;
  }
  return position;
}
export type EditorState = CanvasSnapshot & {
  selected: string[];
  dirty: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
  canUndo: boolean;
  canRedo: boolean;
};
/** One instance per authenticated project. Geometry history never rewinds output receipts. */
export class EditorStore {
  private clipboard: CanvasNode[] = [];
  private pasteCount = 0;
  private clipboardKey = "";
  private listeners = new Set<() => void>();
  private past: CanvasDocument[] = [];
  private future: CanvasDocument[] = [];
  private placements = new Set<string>();
  private seen = new Set<string>();
  private version = 0;
  private lastTextUpdate?: { id: string; version: number };
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private pending: CanvasSave | undefined;
  private state: EditorState;
  constructor(
    snapshot: CanvasSnapshot,
    private readonly persist: (input: CanvasSave) => Promise<CanvasSnapshot>,
  ) {
    this.state = {
      ...snapshot,
      selected: [],
      dirty: false,
      saving: false,
      error: "",
      conflict: false,
      canUndo: false,
      canRedo: false,
    };
  }
  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  select(ids: string[]) {
    this.update({ selected: ids });
  }
  renameNode(id: string, label: string) {
    const name = label.trim();
    if (name.length > 100) throw new Error("名称不能超过 100 个字符。");
    const node = this.state.document.nodes.find((n) => n.id === id);
    if (!node || (!name && node.kind !== "text") || node.label === name) return;
    this.edit({
      ...this.state.document,
      nodes: this.state.document.nodes.map((n) =>
        n.id === id ? { ...n, label: name } : n,
      ),
    });
  }
  addText() {
    this.canAddImage();
    const { nodes, viewport } = this.state.document;
    const position = imagePosition(nodes, viewport, 300, 220);
    if (!position)
      throw new Error("画布当前区域无法放置文案，请平移视图后重试。");
    const node: CanvasNode = {
      id: crypto.randomUUID(),
      kind: "text",
      label: "文案",
      text: "",
      tone: "yellow",
      width: 300,
      height: 220,
      ...position,
    };
    this.edit({ ...this.state.document, nodes: [...nodes, node] });
    this.select([node.id]);
    return node.id;
  }
  updateText(
    id: string,
    patch: Pick<CanvasNode, "text" | "tone">,
    history = true,
  ) {
    const before = this.version;
    const merge =
      !history &&
      this.lastTextUpdate?.id === id &&
      this.lastTextUpdate.version === before;
    this.edit(
      {
        ...this.state.document,
        nodes: this.state.document.nodes.map((n) =>
          n.id === id && n.kind === "text" ? { ...n, ...patch } : n,
        ),
      },
      !merge,
    );
    if (this.version !== before)
      this.lastTextUpdate = { id, version: this.version };
  }
  finishTextEdit() {
    this.lastTextUpdate = undefined;
    while (
      this.past.length &&
      JSON.stringify(this.past.at(-1)) === JSON.stringify(this.state.document)
    )
      this.past.pop();
    this.update({ canUndo: !!this.past.length, canRedo: !!this.future.length });
  }
  markReferenceConflict(message: string) {
    clearTimeout(this.timer);
    this.update({ conflict: true, error: message });
  }
  canAddImage(count = 1) {
    if (this.state.conflict)
      throw new Error("请先处理画布保存冲突，再上传图片。");
    if (this.state.document.nodes.length + count > 1000)
      throw new Error("画布最多容纳 1000 个节点，请先移除部分节点。");
  }
  addUploadedImage(
    asset: { id: string; width: number; height: number },
    name: string,
  ) {
    const existing = this.state.document.nodes.find(
      (n) => n.assetId === asset.id,
    );
    if (existing) {
      this.select([existing.id]);
      return;
    }
    this.canAddImage();
    const { viewport, nodes } = this.state.document;
    const width = 260;
    const height = Math.max(
      40,
      Math.min(10000, (260 * asset.height) / asset.width),
    );
    const position = imagePosition(nodes, viewport, width, height);
    if (!position)
      throw new Error(
        "画布当前区域已无可排列的位置，请平移视图或整理节点后重试。",
      );
    const image: CanvasNode = {
      id: crypto.randomUUID(),
      kind: "image",
      assetId: asset.id,
      label: name.slice(0, 100),
      ...position,
      width,
      height,
    };
    this.edit({ ...this.state.document, nodes: [...nodes, image] });
    this.select([image.id]);
  }
  selectAll() {
    this.select(this.state.document.nodes.map((n) => n.id));
  }
  copySelection() {
    const selected = new Set(this.state.selected);
    const picked = this.state.document.nodes.filter(
      (n) => selected.has(n.id) || selected.has(n.parentId ?? ""),
    );
    if (!picked.length) return false;
    const ids = new Set(picked.map((n) => n.id));
    this.clipboard = picked.map((n) => ({
      ...n,
      parentId: ids.has(n.parentId ?? "") ? n.parentId : undefined,
    }));
    this.pasteCount = 0;
    this.clipboardKey = crypto.randomUUID();
    return true;
  }
  copiedSelectionKey() {
    return this.clipboardKey;
  }
  matchesCopiedSelection(key: string) {
    return !!key && key === this.clipboardKey;
  }
  pasteSelection() {
    if (!this.clipboard.length) return;
    const ids = new Map(this.clipboard.map((n) => [n.id, crypto.randomUUID()]));
    const offset = (this.pasteCount + 1) * 30;
    const pasted = this.clipboard.map((n) => ({
      ...n,
      id: ids.get(n.id)!,
      parentId: n.parentId ? ids.get(n.parentId) : undefined,
      x: n.x + offset,
      y: n.y + offset,
    }));
    const document = {
      ...this.state.document,
      nodes: [...this.state.document.nodes, ...pasted],
    };
    if (!canvasDocument.safeParse(document).success)
      throw new Error(
        "无法粘贴：画布最多容纳 1000 个节点，且节点位置须在允许范围内。",
      );
    this.edit(document);
    this.pasteCount++;
    this.select(pasted.map((n) => n.id));
  }
  duplicateSelection() {
    // Duplicating does not replace the user's copied selection.
    const clipboard = this.clipboard,
      count = this.pasteCount,
      key = this.clipboardKey,
      selected = this.state.selected;
    try {
      if (this.copySelection()) this.pasteSelection();
    } finally {
      this.clipboard = clipboard;
      this.pasteCount = count;
      this.clipboardKey = key;
      this.select(selected);
    }
  }
  edit(document: CanvasDocument, history = true) {
    canvasDocument.parse(document);
    if (JSON.stringify(document) === JSON.stringify(this.state.document))
      return;
    if (history) {
      this.past.push(this.state.document);
      this.past = this.past.slice(-50);
      this.future = [];
    }
    this.version++;
    this.update({
      document,
      dirty: true,
      canUndo: !!this.past.length,
      canRedo: !!this.future.length,
    });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.state.error)
      this.timer = setTimeout(() => void this.flush().catch(() => {}), 600);
  }
  undo() {
    const doc = this.past.pop();
    if (!doc) return;
    this.future.push(this.state.document);
    this.edit(doc, false);
  }
  redo() {
    const doc = this.future.pop();
    if (!doc) return;
    this.past.push(this.state.document);
    this.edit(doc, false);
  }
  place(outputs: CanvasOutput[]) {
    const fresh = outputs
      .filter((o) => !this.seen.has(o.outputId))
      .slice(0, 1000 - this.state.document.nodes.length);
    const nodes = [...this.state.document.nodes];
    const placed: string[] = [];
    for (const o of fresh) {
      const width = 260,
        height = Math.max(60, Math.min(800, (260 * o.height) / o.width));
      const position = imagePosition(
        nodes,
        this.state.document.viewport,
        width,
        height,
      );
      // Leave the receipt pending so a later viewport change can place it safely.
      if (!position) break;
      nodes.push({
        id: crypto.randomUUID(),
        kind: "image",
        assetId: o.assetId,
        label: "生成图片",
        ...position,
        width,
        height,
      });
      placed.push(o.outputId);
    }
    if (!placed.length) return;
    const document = { ...this.state.document, nodes };
    canvasDocument.parse(document);
    placed.forEach((id) => {
      this.placements.add(id);
      this.seen.add(id);
    });
    this.edit(document);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.state.dirty) return this.flush();
      return;
    }
    if (this.state.conflict) throw new Error(this.state.error);
    if (!this.state.dirty) return;
    const epoch = this.epoch;
    this.update({ saving: true, error: "" });
    this.running = (async () => {
      while (this.state.dirty && epoch === this.epoch) {
        const version = this.version;
        const request = this.pending ?? {
          revision: this.state.revision,
          requestKey: crypto.randomUUID(),
          document: this.state.document,
          placements: [...this.placements],
        };
        this.pending = request;
        try {
          const saved = await this.persist(request);
          if (epoch !== this.epoch) return;
          this.pending = undefined;
          // A retry can acknowledge an older draft; never mark newer edits saved.
          const currentMatches =
            JSON.stringify(this.state.document) ===
              JSON.stringify(request.document) &&
            [...this.placements].every((id) => request.placements.includes(id));
          request.placements.forEach((id) => this.placements.delete(id));
          this.update({
            revision: saved.revision,
            dirty: !(version === this.version && currentMatches),
          });
        } catch (e) {
          if (epoch === this.epoch) {
            const code = (e as { code?: string }).code;
            if (code && code !== "INTERNAL_ERROR") this.pending = undefined;
            this.update({
              error: (e as Error).message,
              conflict: code === "CANVAS_CONFLICT",
            });
          }
          throw e;
        }
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
      if (epoch === this.epoch) this.update({ saving: false });
    }
  }
  copyInput(): CanvasSave {
    return {
      revision: this.state.revision,
      requestKey: crypto.randomUUID(),
      document: this.state.document,
      placements: [],
    };
  }
  reset(snapshot: CanvasSnapshot) {
    this.epoch++;
    this.pending = undefined;
    this.past = [];
    this.future = [];
    this.placements.clear();
    this.seen.clear();
    this.version++;
    clearTimeout(this.timer);
    this.update({
      ...snapshot,
      dirty: false,
      saving: false,
      error: "",
      conflict: false,
      selected: [],
      canUndo: false,
      canRedo: false,
    });
  }
  dispose() {
    this.epoch++;
    this.clipboard = [];
    this.clipboardKey = "";
    this.pasteCount = 0;
    clearTimeout(this.timer);
    this.listeners.clear();
    this.pending = undefined;
    this.past = [];
    this.future = [];
    this.placements.clear();
    this.seen.clear();
  }
}
