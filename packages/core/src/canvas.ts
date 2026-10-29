import {
  canvasSave,
  type CanvasSave,
  type CanvasSnapshot,
  type CanvasOutput,
  type CanvasSources,
  type Principal,
  type Project,
} from "@tuyile/contracts";
export interface CanvasRepository {
  load(p: Principal, projectId: string): Promise<CanvasSnapshot>;
  save(
    p: Principal,
    projectId: string,
    input: CanvasSave,
  ): Promise<CanvasSnapshot>;
  copy(p: Principal, projectId: string, input: CanvasSave): Promise<Project>;
  pending(p: Principal, projectId: string): Promise<CanvasOutput[]>;
  sources(p: Principal, projectId: string): Promise<CanvasSources[]>;
}
export interface CanvasStore {
  read<T>(run: (r: CanvasRepository) => Promise<T>): Promise<T>;
  write<T>(
    ownerId: string,
    run: (r: CanvasRepository) => Promise<T>,
  ): Promise<T>;
}
export class CanvasService {
  constructor(private readonly store: CanvasStore) {}
  load(p: Principal, project: string) {
    return this.store.read((r) => r.load(p, project));
  }
  save(p: Principal, project: string, input: CanvasSave) {
    const parsed = canvasSave.parse(input);
    return this.store.write(p.id, (r) => r.save(p, project, parsed));
  }
  copy(p: Principal, project: string, input: CanvasSave) {
    const parsed = canvasSave.parse(input);
    return this.store.write(p.id, (r) => r.copy(p, project, parsed));
  }
  pendingSnapshot(p: Principal, project: string) {
    return this.store.read(async (r) => ({
      revision: (await r.load(p, project)).revision,
      outputs: await r.pending(p, project),
    }));
  }
  pending(p: Principal, project: string) {
    return this.store.read((r) => r.pending(p, project));
  }
  sources(p: Principal, project: string) {
    return this.store.read((r) => r.sources(p, project));
  }
}
