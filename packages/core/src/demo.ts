import type {
  DemoStatus,
  DemoTemplateInfo,
  ProjectDemo,
  PublishDemoInput,
  Principal,
  CanvasDocument,
  ProjectDraftDocument,
  DemoImage,
} from "@tuyile/contracts";
import { AppError } from "./index.js";
import type { ImageFiles, StoredAsset } from "./creation.js";
export interface DemoManifest {
  name: string;
  document: CanvasDocument;
  draft: ProjectDraftDocument;
  images: (DemoImage & { source: StoredAsset; previewBytes: number })[];
}
export interface DemoPlan {
  projectId: string;
  assets: { sourceId: string; target: StoredAsset }[];
}
export interface DemoWork {
  manifest: DemoManifest;
  plan: DemoPlan;
}
export interface DemoInitialization {
  prepare(): Promise<DemoWork | DemoStatus>;
  complete(work: DemoWork): Promise<DemoStatus>;
  fail(): Promise<void>;
}
export interface DemoStore {
  publish(p: Principal, input: PublishDemoInput): Promise<DemoTemplateInfo>;
  template(p: Principal): Promise<DemoTemplateInfo | null>;
  status(p: Principal, targetId: string): Promise<DemoStatus>;
  initialize(
    p: Principal,
    targetId: string,
    work: (r: DemoInitialization) => Promise<DemoStatus>,
  ): Promise<DemoStatus>;
  claimOpen(p: Principal): Promise<DemoStatus>;
  project(p: Principal, projectId: string): Promise<ProjectDemo | null>;
}
export class DemoService {
  constructor(
    private readonly store: DemoStore,
    private readonly files: ImageFiles,
  ) {}
  publish(p: Principal, input: PublishDemoInput) {
    return this.store.publish(p, input);
  }
  template(p: Principal) {
    return this.store.template(p);
  }
  status(p: Principal, targetId = p.id) {
    return this.store.status(p, targetId);
  }
  project(p: Principal, id: string) {
    return this.store.project(p, id);
  }
  async initialize(
    p: Principal,
    targetId = p.id,
    open = false,
  ): Promise<DemoStatus> {
    const result = await this.store.initialize(p, targetId, async (r) => {
      try {
        const work = await r.prepare();
        if (!("manifest" in work)) return work;
        if (!(await this.files.freeSpace()))
          throw new AppError("DISK_LOW", 507);
        for (const item of work.plan.assets) {
          const image = work.manifest.images.find(
            (i) => i.assetId === item.sourceId,
          )!;
          const original = await this.files.read(image.source);
          const preview = await this.files.read(image.source, true);
          if (
            original.length !== image.source.bytes ||
            preview.length !== image.previewBytes
          )
            throw new AppError("ASSET_UNAVAILABLE", 404);
          // A durable plan owns these keys until publication; a failed copy can be retried.
          let complete = false;
          try {
            const [a, b] = await Promise.all([
              this.files.read(item.target),
              this.files.read(item.target, true),
            ]);
            complete =
              a.length === original.length && b.length === preview.length;
          } catch {}
          if (!complete) {
            await this.files.remove(item.target.fileKey);
            await this.files.write(item.target.fileKey, {
              original,
              preview,
              mime: image.source.mime!,
              width: image.source.width!,
              height: image.source.height!,
              hash: image.source.hash!,
            });
          }
        }
        return await r.complete(work);
      } catch {
        await r.fail();
        return { state: "failed" };
      }
    });
    return open && result.state === "ready" ? this.store.claimOpen(p) : result;
  }
}
