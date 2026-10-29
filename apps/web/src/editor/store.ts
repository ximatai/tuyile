import {
  canvasDocument,
  type CanvasDocument,
  type CanvasSnapshot,
  type CanvasSave,
  type CanvasOutput,
} from "@tuyile/contracts";
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
  private listeners = new Set<() => void>();
  private past: CanvasDocument[] = [];
  private future: CanvasDocument[] = [];
  private placements = new Set<string>();
  private seen = new Set<string>();
  private version = 0;
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
    if (!fresh.length) return;
    fresh.forEach((o) => {
      this.placements.add(o.outputId);
      this.seen.add(o.outputId);
    });
    const nodes = [...this.state.document.nodes];
    for (const o of fresh) {
      const i = nodes.length;
      nodes.push({
        id: crypto.randomUUID(),
        kind: "image",
        assetId: o.assetId,
        label: "生成图片",
        x: 60 + (i % 4) * 300,
        y: 110 + Math.floor(i / 4) * 340,
        width: 260,
        height: Math.max(60, Math.min(800, (260 * o.height) / o.width)),
      });
    }
    this.edit({ ...this.state.document, nodes });
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
    clearTimeout(this.timer);
    this.listeners.clear();
    this.pending = undefined;
    this.past = [];
    this.future = [];
    this.placements.clear();
    this.seen.clear();
  }
}
