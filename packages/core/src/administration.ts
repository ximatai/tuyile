import { AppError } from "./index.js";
import type { ImageFiles, StoredAsset } from "./creation.js";
import type { AdminArtwork } from "@tuyile/contracts";
import {
  executionSettingsInput,
  planningPolicyInput,
  type ExecutionSettings,
  type PlanningPolicy,
  type Principal,
  type AdminSummary,
} from "@tuyile/contracts";
export interface AdministrationRepository {
  artworks(
    p: Principal,
    userId: string,
    offset: number,
  ): Promise<AdminArtwork[]>;
  artwork(p: Principal, userId: string, assetId: string): Promise<StoredAsset>;
  tokenUsage(
    p: Principal,
    period: "today" | "month" | "all",
    offset?: number,
  ): Promise<import("@tuyile/contracts").ModelUsageReport>;
  settings(p: Principal): Promise<ExecutionSettings>;
  saveSettings(p: Principal, input: ExecutionSettings): Promise<void>;
  policy(p: Principal, userId: string): Promise<PlanningPolicy>;
  savePolicy(
    p: Principal,
    userId: string,
    input: PlanningPolicy,
  ): Promise<void>;
  summary(p: Principal): Promise<AdminSummary>;
}
export interface AdministrationStore {
  read<T>(run: (r: AdministrationRepository) => Promise<T>): Promise<T>;
  write<T>(
    owners: string[],
    run: (r: AdministrationRepository) => Promise<T>,
    queue?: boolean,
  ): Promise<T>;
}
export class AdministrationService {
  constructor(
    private readonly store: AdministrationStore,
    private readonly files?: ImageFiles,
  ) {}
  artworks(p: Principal, userId: string, offset: number) {
    return this.store.read((r) => r.artworks(p, userId, offset));
  }
  async bytes(p: Principal, userId: string, assetId: string, preview: boolean) {
    const asset = await this.store.write(
      [p.id],
      (r) => r.artwork(p, userId, assetId),
      false,
    );
    if (!this.files || !asset.mime) throw new AppError("NOT_FOUND", 404);
    return {
      mime: preview ? "image/webp" : asset.mime,
      bytes: await this.files.read(asset, preview),
    };
  }
  tokenUsage(p: Principal, period: "today" | "month" | "all", offset = 0) {
    return this.store.read((r) => r.tokenUsage(p, period, offset));
  }
  settings(p: Principal) {
    return this.store.read((r) => r.settings(p));
  }
  saveSettings(p: Principal, input: ExecutionSettings) {
    const parsed = executionSettingsInput.parse(input);
    return this.store.write([p.id], (r) => r.saveSettings(p, parsed));
  }
  policy(p: Principal, userId: string) {
    return this.store.read((r) => r.policy(p, userId));
  }
  savePolicy(p: Principal, userId: string, input: PlanningPolicy) {
    const parsed = planningPolicyInput.parse(input);
    return this.store.write([p.id, userId], (r) =>
      r.savePolicy(p, userId, parsed),
    );
  }
  summary(p: Principal) {
    return this.store.read((r) => r.summary(p));
  }
}
