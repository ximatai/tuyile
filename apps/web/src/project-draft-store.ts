import {
  emptyProjectDraft,
  type ProjectDraftDocument,
  type ProjectDraftSave,
  type ProjectDraftSnapshot,
} from "@tuyile/contracts";
export interface DraftState {
  document: ProjectDraftDocument;
  revision: number;
  ready: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
  epoch: number;
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              canonical((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;
const serialize = (value: unknown) => JSON.stringify(canonical(value));
export class ProjectDraftStore {
  private state: DraftState = {
    document: emptyProjectDraft(),
    revision: 0,
    ready: false,
    dirty: false,
    saving: false,
    error: "",
    conflict: false,
    epoch: 0,
  };
  private listeners = new Set<() => void>();
  private baseline = serialize(this.state.document);
  private pending: ProjectDraftSave | null = null;
  private flight: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private editVersion = 0;
  private resolutionVersion = 0;
  private controller = new AbortController();
  constructor(
    private read: (signal: AbortSignal) => Promise<ProjectDraftSnapshot>,
    private write: (
      input: ProjectDraftSave,
      signal: AbortSignal,
    ) => Promise<ProjectDraftSnapshot>,
  ) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<DraftState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  load() {
    if (this.state.ready || this.disposed) return Promise.resolve();
    if (!this.loading)
      this.loading = this.read(this.controller.signal)
        .then((snapshot) => {
          if (this.disposed) return;
          this.baseline = serialize(snapshot.document);
          this.update({
            ...snapshot,
            ready: true,
            error: "",
            dirty: false,
            epoch: this.state.epoch + 1,
          });
        })
        .catch((error) => {
          this.update({ error: (error as Error).message });
          throw error;
        })
        .finally(() => {
          this.loading = null;
        });
    return this.loading;
  }
  edit(patch: Partial<ProjectDraftDocument>) {
    if (!this.state.ready || this.disposed) return;
    const document = { ...this.state.document, ...patch };
    if (serialize(document) === serialize(this.state.document)) return;
    this.editVersion++;
    const dirty = serialize(document) !== this.baseline || !!this.pending;
    this.update({
      document,
      dirty,
      error: this.state.conflict ? this.state.error : "",
    });
    clearTimeout(this.timer);
    if (dirty && !this.state.conflict)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, 1000);
  }
  async flush(): Promise<void> {
    if (this.disposed) return;
    await this.load();
    if (this.flight) return this.flight;
    if (this.state.conflict) throw new Error(this.state.error);
    clearTimeout(this.timer);
    const run = async () => {
      while ((this.state.dirty || this.pending) && !this.disposed) {
        this.pending ??= {
          revision: this.state.revision,
          requestKey: crypto.randomUUID(),
          document: this.state.document,
        };
        this.update({ saving: true, error: "" });
        try {
          const snapshot = await this.write(
            this.pending,
            this.controller.signal,
          );
          if (this.disposed) return;
          this.baseline = serialize(snapshot.document);
          this.pending = null;
          this.update({
            revision: snapshot.revision,
            dirty: serialize(this.state.document) !== this.baseline,
            saving: false,
          });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code && code !== "INTERNAL_ERROR") this.pending = null;
          this.update({
            saving: false,
            error: (error as Error).message,
            conflict: code === "DRAFT_CONFLICT",
          });
          throw error;
        }
      }
    };
    this.flight = run().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  async reload() {
    const resolution = ++this.resolutionVersion;
    const edits = this.editVersion;
    await this.flight?.catch(() => {});
    const snapshot = await this.read(this.controller.signal);
    if (this.disposed || resolution !== this.resolutionVersion) return;
    if (edits !== this.editVersion) {
      clearTimeout(this.timer);
      this.update({
        dirty: true,
        conflict: true,
        error: "加载期间内容已修改，当前输入已保留。请重新选择草稿版本。",
      });
      return;
    }
    clearTimeout(this.timer);
    this.pending = null;
    this.baseline = serialize(snapshot.document);
    this.update({
      ...snapshot,
      ready: true,
      dirty: false,
      error: "",
      conflict: false,
      epoch: this.state.epoch + 1,
    });
  }
  async overwrite() {
    const resolution = ++this.resolutionVersion;
    await this.flight?.catch(() => {});
    const snapshot = await this.read(this.controller.signal);
    if (this.disposed || resolution !== this.resolutionVersion) return;
    this.pending = null;
    this.baseline = serialize(snapshot.document);
    this.update({
      revision: snapshot.revision,
      dirty: serialize(this.state.document) !== this.baseline,
      error: "",
      conflict: false,
    });
    await this.flush();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.controller.abort();
    this.listeners.clear();
  }
}
