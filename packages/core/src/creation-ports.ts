import type {
  ImageInput,
  ImagePolicy,
  ImageTask,
  ImageUsage,
  Principal,
  ProviderInput,
  ProviderView,
  ReviewTask,
} from "@tuyile/contracts";
import type {
  StoredAsset,
  AssetBytes,
  WorkItem,
  Dispatch,
} from "./creation.js";
import type { checkAdmissionBudget } from "./creation-policy.js";
export interface AdmissionSnapshot {
  day: string;
  budget: Parameters<typeof checkAdmissionBudget>[0];
}
export interface PreparedAsset extends StoredAsset {
  ordinal: number | null;
  reservedBytes: number;
}
export interface OutputSettlement {
  outputId: string;
  taskId: string;
  workspaceId: string;
  userId: string;
  day: string;
}
export interface OutputsRepository {
  record(asset: PreparedAsset, attemptId: string): Promise<OutputSettlement>;
}
export interface TasksRepository {
  existingAdmission(p: Principal, input: ImageInput): Promise<ImageTask | null>;
  insert(
    p: Principal,
    input: ImageInput,
    snapshot: AdmissionSnapshot,
    providerId: string,
  ): Promise<ImageTask>;
  tasks(
    p: Principal,
    projectId?: string,
    offset?: number,
  ): Promise<ImageTask[]>;
  task(p: Principal, id: string): Promise<ImageTask>;
  recover(p: Principal, projectId: string, key: string): Promise<ImageTask>;
  cancel(p: Principal, id: string): Promise<void>;
}
export interface AssetsRepository {
  uploads(p: Principal, offset?: number): Promise<StoredAsset[]>;
  reserveUpload(p: Principal): Promise<StoredAsset>;
  prepareCommit(
    asset: StoredAsset,
    image: AssetBytes,
  ): Promise<PreparedAsset | null>;
  publish(asset: PreparedAsset, image: AssetBytes): Promise<void>;
  pin(p: Principal, taskId: string, referenceIds: string[]): Promise<void>;
  abandonAsset(asset: StoredAsset): Promise<boolean>;
  asset(p: Principal, id: string): Promise<StoredAsset>;
  deleteAsset(p: Principal, id: string): Promise<StoredAsset>;
  finalizeDelete(asset: StoredAsset): Promise<void>;
  staleAssets(): Promise<StoredAsset[]>;
}
export interface QuotaRepository {
  admission(p: Principal, input: ImageInput): Promise<AdmissionSnapshot>;
  reserve(
    p: Principal,
    taskId: string,
    snapshot: AdmissionSnapshot,
  ): Promise<void>;
  consume(output: OutputSettlement): Promise<void>;
  usage(p: Principal): Promise<ImageUsage>;
  getPolicy(p: Principal, userId: string): Promise<ImagePolicy>;
  setPolicy(p: Principal, userId: string, policy: ImagePolicy): Promise<void>;
  review(p: Principal): Promise<ReviewTask[]>;
  resolve(
    p: Principal,
    id: string,
    confirmed: number,
    reason: string,
  ): Promise<void>;
}
export interface ProvidersRepository {
  current(): Promise<{ id: string; models: string[] }>;
  saveProvider(p: Principal, input: ProviderInput): Promise<ProviderView>;
  providers(p: Principal): Promise<ProviderView[]>;
  revokeProvider(p: Principal, id: string): Promise<void>;
}
export interface ExecutionRepository {
  startWorker(): Promise<void>;
  claim(activeUserIds: string[], activeCount: number): Promise<WorkItem | null>;
  stopRequested(task: WorkItem): Promise<boolean>;
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
  references(task: WorkItem): Promise<StoredAsset[]>;
  outputIntent(task: WorkItem, ordinal: number): Promise<StoredAsset>;
  finish(
    task: WorkItem,
    errorCode?: string,
    cancelled?: boolean,
  ): Promise<void>;
}
export interface CreationUnitOfWork {
  outputs: OutputsRepository;
  tasks: TasksRepository;
  assets: AssetsRepository;
  quota: QuotaRepository;
  providers: ProvidersRepository;
  execution: ExecutionRepository;
}
export type CreationLock = {
  owners: string[];
  queue?: boolean;
  taskId?: string;
  attemptId?: string;
  taskState?: "queued" | "running";
};
export interface CreationStore {
  read<T>(run: (repositories: CreationUnitOfWork) => Promise<T>): Promise<T>;
  write<T>(
    lock: CreationLock,
    run: (repositories: CreationUnitOfWork) => Promise<T>,
  ): Promise<T>;
}
export type ImageExecutionOperations = ExecutionRepository &
  Pick<AssetsRepository, "abandonAsset" | "finalizeDelete" | "staleAssets"> & {
    commitAsset(
      asset: StoredAsset,
      image: AssetBytes,
      attemptId?: string,
    ): Promise<void>;
  };
