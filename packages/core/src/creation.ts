import { AppError } from "./index.js";
import type {
  ImageInput,
  ImagePolicy,
  ImageTask,
  ImageAsset,
  ImageUsage,
  Principal,
  ProviderInput,
  ProviderView,
  ReviewTask,
} from "@tuyile/contracts";
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
  mime: string;
  width: number;
  height: number;
  bytes: number;
  previewBytes: number;
  hash: string;
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
  provider: ProviderInput;
}
export interface CreationRepository {
  admit(p: Principal, input: ImageInput): Promise<ImageTask>;
  tasks(
    p: Principal,
    projectId?: string,
    offset?: number,
  ): Promise<ImageTask[]>;
  task(p: Principal, id: string): Promise<ImageTask>;
  recover(p: Principal, projectId: string, key: string): Promise<ImageTask>;
  usage(p: Principal): Promise<ImageUsage>;
  cancel(p: Principal, id: string): Promise<void>;
  uploads(p: Principal, offset?: number): Promise<StoredAsset[]>;
  reserveUpload(p: Principal): Promise<StoredAsset>;
  commitAsset(
    asset: StoredAsset,
    image: AssetBytes,
    attemptId?: string,
  ): Promise<void>;
  abandonAsset(asset: StoredAsset): Promise<boolean>;
  asset(p: Principal, id: string): Promise<StoredAsset>;
  deleteAsset(p: Principal, id: string): Promise<StoredAsset>;
  finalizeDelete(asset: StoredAsset): Promise<void>;
  saveProvider(p: Principal, input: ProviderInput): Promise<ProviderView>;
  providers(p: Principal): Promise<ProviderView[]>;
  revokeProvider(p: Principal, id: string): Promise<void>;
  setPolicy(p: Principal, userId: string, policy: ImagePolicy): Promise<void>;
  getPolicy(p: Principal, userId: string): Promise<ImagePolicy>;
  review(p: Principal): Promise<ReviewTask[]>;
  resolve(
    p: Principal,
    id: string,
    confirmed: number,
    reason: string,
  ): Promise<void>;
  startWorker(): Promise<void>;
  claim(activeUserIds: string[], activeCount: number): Promise<WorkItem | null>;
  dispatch(
    task: WorkItem,
    ordinal: number,
    retry: number,
  ): Promise<Dispatch | null>;
  attemptResult(
    id: string,
    state: "received" | "rejected" | "unknown",
    status?: number,
    code?: string,
  ): Promise<void>;
  outputIntent(task: WorkItem, ordinal: number): Promise<StoredAsset>;
  references(task: WorkItem): Promise<StoredAsset[]>;
  stopRequested(task: WorkItem): Promise<boolean>;
  finish(
    task: WorkItem,
    errorCode?: string,
    cancelled?: boolean,
  ): Promise<void>;
  staleAssets(): Promise<StoredAsset[]>;
}
export class CreationService {
  constructor(
    public repository: CreationRepository,
    public files: ImageFiles,
  ) {}
  async submit(p: Principal, input: ImageInput) {
    if (!(await this.files.freeSpace())) throw new AppError("DISK_LOW", 507);
    return this.repository.admit(p, input);
  }
  async upload(p: Principal, bytes: Uint8Array) {
    if (bytes.length > 20 * 1024 * 1024)
      throw new AppError("UPLOAD_TOO_LARGE", 413);
    if (!(await this.files.freeSpace())) throw new AppError("DISK_LOW", 507);
    const image = await this.files.inspect(bytes);
    const asset = await this.repository.reserveUpload(p);
    try {
      await this.files.write(asset.fileKey, image);
      await this.repository.commitAsset(asset, image);
      return this.repository.asset(p, asset.id);
    } catch (e) {
      if (await this.repository.abandonAsset(asset)) {
        await this.files.remove(asset.fileKey);
        await this.repository.finalizeDelete(asset);
      }
      throw e;
    }
  }
  async bytes(p: Principal, id: string, preview = false) {
    const asset = await this.repository.asset(p, id);
    return { asset, bytes: await this.files.read(asset, preview) };
  }
  async delete(p: Principal, id: string) {
    const asset = await this.repository.deleteAsset(p, id);
    await this.files.remove(asset.fileKey);
    await this.repository.finalizeDelete(asset);
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
    config: ProviderInput,
    input: ImageInput,
    references: Uint8Array[],
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}
export class ImageExecutor {
  constructor(
    private repo: CreationRepository,
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
