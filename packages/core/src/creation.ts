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
  imageLimit: 20,
  attemptsLimit: 60,
  storageLimit: 2147483648,
  concurrency: 1,
  queueLimit: 10,
  maxEdge: 2048,
  maxPixels: 4194304,
  maxCount: 4,
  maxQuality: "high",
  allowedModels: [],
};
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
    (policy.allowedModels.length && !policy.allowedModels.includes(input.model))
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
  inspect(bytes: Uint8Array): Promise<AssetBytes>;
  write(key: string, image: AssetBytes): Promise<void>;
  read(asset: StoredAsset, preview?: boolean): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  freeSpace(): Promise<boolean>;
}
export interface WorkItem {
  id: string;
  userId: string;
  workspaceId: string;
  input: ImageInput;
  deadline: Date;
  providerId: string;
}
export interface Dispatch {
  attemptId: string;
  provider: ImageExecutionConfig;
}
export class CreationService extends ImageOperations {
  constructor(
    store: CreationStore,
    private readonly files: ImageFiles,
  ) {
    super(store);
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
  async bytes(p: Principal, id: string, preview = false) {
    const asset = await this.asset(p, id);
    if (!asset.mime) throw new AppError("ASSET_UNAVAILABLE", 404);
    return {
      asset: { ...asset, mime: asset.mime },
      bytes: await this.files.read(asset, preview),
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
export interface ImageProvider {
  generate(
    config: ImageExecutionConfig,
    input: ImageInput,
    references: Uint8Array[],
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}
export class ImageExecutor {
  constructor(
    private repo: ImageExecutionOperations,
    private files: ImageFiles,
    private provider: ImageProvider,
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
            const response = await this.provider.generate(
              dispatched.provider,
              task.input,
              bytes,
              signal,
            );
            await this.repo.attemptResult(dispatched.attemptId, "received");
            const image = await this.files.inspect(response);
            if (
              image.width > task.input.width ||
              image.height > task.input.height
            )
              throw new ImageCallError("unknown", "OUTPUT_SPEC_MISMATCH");
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
