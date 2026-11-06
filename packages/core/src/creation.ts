import { imageInput, composeCreativePrompt } from "@tuyile/contracts";
import { createToolRegistry, type ToolRegistry } from "./tools.js";
import type { ToolBinding } from "@tuyile/contracts";
import { ImageOperations } from "./image-operations.js";
import type {
  CreationStore,
  ImageExecutionOperations,
} from "./creation-ports.js";
export * from "./creation-ports.js";
export * from "./image-operations.js";
import { AppError } from "./index.js";
import type { ImageExecutionConfig } from "./provider-config.js";
import type { ImageInput, ImagePolicy, Principal } from "@tuyile/contracts";
export const ASSET_RESERVE = 21 * 1024 * 1024;
export const defaultImagePolicy: ImagePolicy = {
  imageLimit: 100,
  attemptsLimit: 300,
  storageLimit: 2147483648,
  concurrency: 1,
  queueLimit: 10,
  maxEdge: 2048,
  maxPixels: 4194304,
  maxCount: 4,
  maxQuality: "high",
  allowedModels: [],
};
export function imagePolicyDefaults(role: Principal["role"]): ImagePolicy {
  return {
    ...defaultImagePolicy,
    imageLimit: role === "admin" ? -1 : 100,
    allowedModels: [],
  };
}
export function shanghaiDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function checkImageSpec(
  input: ImageInput,
  policy: ImagePolicy,
  models: string[],
) {
  const quality = { low: 0, medium: 1, high: 2 };
  if (
    input.width > policy.maxEdge ||
    input.height > policy.maxEdge ||
    input.width * input.height > policy.maxPixels ||
    input.count > policy.maxCount ||
    quality[input.quality] > quality[policy.maxQuality]
  )
    throw new AppError("SPEC_LIMIT", 409);
  if (
    !models.includes(input.model) ||
    (policy.allowedModels.length &&
      !policy.allowedModels.includes(input.modelSelectionId ?? input.model))
  )
    throw new AppError("MODEL_NOT_ALLOWED", 409);
}
export interface StoredAsset {
  id: string;
  workspaceId: string;
  userId: string;
  fileKey: string;
  state: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  previewBytes: number;
  hash: string | null;
  taskId: string | null;
  derivedFrom?: string | null;
  revisionOf?: string | null;
}
export interface AssetBytes {
  original: Uint8Array;
  preview: Uint8Array;
  mime: string;
  width: number;
  height: number;
  hash: string;
}
export interface ImageFiles {
  inspect(bytes: Uint8Array, vector?: boolean): Promise<AssetBytes>;
  rasterize?(bytes: Uint8Array): Promise<Uint8Array>;
  write(key: string, image: AssetBytes): Promise<void>;
  read(asset: StoredAsset, preview?: boolean): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  freeSpace(): Promise<boolean>;
}
export interface WorkItem {
  finalPrompt?: string;
  skillId?: string | null;
  id: string;
  userId: string;
  workspaceId: string;
  input: ImageInput;
  deadline: Date;
  providerId: string;
  tool: ToolBinding;
}
export interface Dispatch {
  attemptId: string;
  provider: ImageExecutionConfig;
}
export class CreationService extends ImageOperations {
  constructor(
    store: CreationStore,
    private readonly files: ImageFiles,
    registry: ToolRegistry = createToolRegistry(),
  ) {
    super(store, registry);
  }
  async submit(p: Principal, input: ImageInput) {
    if (!(await this.files.freeSpace())) throw new AppError("DISK_LOW", 507);
    return this.admit(p, input);
  }
  async upload(p: Principal, bytes: Uint8Array) {
    if (bytes.length > 20 * 1024 * 1024)
      throw new AppError("UPLOAD_TOO_LARGE", 413);
    if (!(await this.files.freeSpace())) throw new AppError("DISK_LOW", 507);
    const image = await this.files.inspect(bytes);
    const asset = await this.reserveUpload(p);
    try {
      await this.files.write(asset.fileKey, image);
      await this.commitAsset(asset, image);
      return this.asset(p, asset.id);
    } catch (e) {
      if (await this.abandonAsset(asset)) {
        await this.files.remove(asset.fileKey);
        await this.finalizeDelete(asset);
      }
      throw e;
    }
  }
  async rasterCopy(p: Principal, id: string) {
    if (!this.files.rasterize)
      throw new AppError("SVG_CONVERSION_UNAVAILABLE", 503);
    if (!(await this.files.freeSpace())) throw new AppError("DISK_LOW", 507);
    const target = await this.store.write({ owners: [p.id] }, (r) =>
      r.assets.reserveDerivative(p, id),
    );
    if (target.state === "ready") return target;
    try {
      const source = await this.asset(p, id);
      const png = await this.files.rasterize(await this.files.read(source));
      const image = await this.files.inspect(png);
      await this.files.write(target.fileKey, image);
      await this.commitAsset(target, image);
      return this.asset(p, target.id);
    } catch (error) {
      if (await this.abandonAsset(target)) {
        await this.files.remove(target.fileKey);
        await this.finalizeDelete(target);
      }
      throw error;
    }
  }
  svgRevisions(p: Principal, id: string) {
    return this.store.read((r) => r.assets.svgRevisions(p, id));
  }
  async importSvgRevision(p: Principal, id: string, bytes: Uint8Array) {
    const source = await this.asset(p, id);
    if (source.mime !== "image/svg+xml" || source.revisionOf)
      throw new AppError("SVG_REVISION_SOURCE_REQUIRED", 409);
    if (!(await this.files.freeSpace())) throw new AppError("DISK_LOW", 507);
    const image = await this.files.inspect(bytes, true);
    const target = await this.store.write({ owners: [p.id] }, (r) =>
      r.assets.reserveSvgRevision(p, id, image),
    );
    if (target.state === "ready") return target;
    try {
      await this.files.write(target.fileKey, image);
      await this.commitAsset(target, image);
      return this.asset(p, target.id);
    } catch (error) {
      if (await this.abandonAsset(target)) {
        await this.files.remove(target.fileKey);
        await this.finalizeDelete(target);
      }
      throw error;
    }
  }
  async bytes(p: Principal, id: string, preview = false, download = false) {
    const asset = await this.asset(p, id);
    if (!asset.mime) throw new AppError("ASSET_UNAVAILABLE", 404);
    const safePreview =
      preview || (asset.mime === "image/svg+xml" && !download);
    return {
      asset: { ...asset, mime: safePreview ? "image/webp" : asset.mime },
      bytes: await this.files.read(asset, safePreview),
    };
  }
  async delete(p: Principal, id: string) {
    const asset = await this.deleteAsset(p, id);
    await this.files.remove(asset.fileKey);
    await this.finalizeDelete(asset);
  }
}
export class ImageCallError extends Error {
  constructor(
    public kind: "rejected" | "unknown",
    public code: string,
    public status?: number,
  ) {
    super(code);
  }
}
/** Finalize once, stripping stored composition metadata before the protocol adapter. */
export function imageDispatchInput(
  input: ImageInput,
  finalPrompt?: string,
): ImageInput {
  const parsed = imageInput.parse(input);
  return {
    ...parsed,
    prompt: finalPrompt ?? composeCreativePrompt(input),
    style: undefined,
    preserveRequirements: undefined,
  };
}
export interface ImageProvider {
  generate(
    config: ImageExecutionConfig,
    input: ImageInput,
    references: Uint8Array[],
    signal: AbortSignal,
    onUsage?: (usage: import("./model-usage.js").ModelUsage) => Promise<void>,
  ): Promise<Uint8Array>;
}
export class ImageExecutor {
  constructor(
    private repo: ImageExecutionOperations,
    private files: ImageFiles,
    private provider: ImageProvider,
    private registry: ToolRegistry = createToolRegistry(),
  ) {}
  async execute(task: WorkItem, signal: AbortSignal) {
    let code: string | undefined;
    let cancelled = false;
    try {
      for (let ordinal = 0; ordinal < task.input.count; ordinal++) {
        if (signal.aborted || (await this.repo.stopRequested(task))) {
          cancelled = true;
          break;
        }
        const refs = await this.repo.references(task);
        if (refs.some((r) => r.mime === "image/svg+xml"))
          throw new AppError("SVG_RASTER_REFERENCE_REQUIRED", 409);
        const bytes = await Promise.all(refs.map((r) => this.files.read(r)));
        if (refs.length !== new Set(task.input.referenceIds).size)
          throw new AppError("REFERENCE_UNAVAILABLE", 404);
        for (let retry = 0; retry < 2; retry++) {
          const dispatched = await this.repo.dispatch(task, ordinal, retry);
          if (!dispatched) {
            cancelled = true;
            break;
          }
          try {
            const response = await this.registry.execute(
              task.tool,
              task.input,
              {
                signal,
                generate: () =>
                  this.provider.generate(
                    dispatched.provider,
                    imageDispatchInput(task.input, task.finalPrompt),
                    bytes,
                    signal,
                    (usage) =>
                      this.repo.recordUsage(dispatched.attemptId, usage),
                  ),
              },
            );
            await this.repo.attemptResult(dispatched.attemptId, "received");
            let image: AssetBytes;
            try {
              image = await this.files.inspect(
                response,
                task.input.format === "svg",
              );
            } catch (error) {
              // Received bytes are discarded locally; never retry a paid generation for a rendering failure.
              if (task.input.format === "svg")
                throw new ImageCallError(
                  "rejected",
                  error instanceof AppError ? error.code : "SVG_PREVIEW_FAILED",
                );
              throw error;
            }
            if (
              image.width > task.input.width ||
              image.height > task.input.height
            )
              throw new ImageCallError(
                task.input.format === "svg" ? "rejected" : "unknown",
                "OUTPUT_SPEC_MISMATCH",
              );
            const asset = await this.repo.outputIntent(task, ordinal);
            try {
              await this.files.write(asset.fileKey, image);
              await this.repo.commitAsset(asset, image, dispatched.attemptId);
            } catch (e) {
              if (await this.repo.abandonAsset(asset)) {
                await this.files.remove(asset.fileKey);
                await this.repo.finalizeDelete(asset);
              }
              throw e;
            }
            break;
          } catch (e) {
            const failure =
              e instanceof ImageCallError
                ? e
                : new ImageCallError(
                    "unknown",
                    signal.aborted ? "CANCELLED_IN_FLIGHT" : "RESULT_UNKNOWN",
                  );
            await this.repo.attemptResult(
              dispatched.attemptId,
              failure.kind,
              failure.status,
              failure.code,
            );
            if (
              failure.kind === "rejected" &&
              failure.status === 429 &&
              retry === 0 &&
              !signal.aborted
            )
              continue;
            code = failure.code;
            throw failure;
          }
        }
        if (cancelled) break;
      }
    } catch (e) {
      code ??= e instanceof AppError ? e.code : "RESULT_UNKNOWN";
    }
    await this.repo.finish(task, code, cancelled || signal.aborted);
  }
}
