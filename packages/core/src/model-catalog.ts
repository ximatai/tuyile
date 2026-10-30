import type {
  Principal,
  ModelCatalogSnapshot,
  ModelServiceInput,
  ModelServiceView,
  PoolPublication,
  UserModelPools,
} from "@tuyile/contracts";
import { modelServiceInput, poolPublication } from "@tuyile/contracts";
import type { CreationStore } from "./creation-ports.js";
export interface DirectoryConfig {
  mode: "openai" | "fake";
  baseUrl: string;
  apiKey: string;
  versionId: string;
}
export interface ModelDirectory {
  list(config: DirectoryConfig, signal: AbortSignal): Promise<string[]>;
}
export interface ModelCatalogRepository {
  snapshot(p: Principal): Promise<ModelCatalogSnapshot>;
  bootstrap(p: Principal): Promise<void>;
  saveService(
    p: Principal,
    input: ModelServiceInput,
  ): Promise<ModelServiceView>;
  directory(p: Principal, id: string): Promise<DirectoryConfig>;
  refresh(
    p: Principal,
    id: string,
    version: string,
    models: string[],
  ): Promise<void>;
  manual(p: Principal, id: string, model: string): Promise<void>;
  publish(p: Principal, input: PoolPublication): Promise<void>;
  state(
    p: Principal,
    id: string,
    revision: number,
    enabled: boolean,
    revoke: boolean,
  ): Promise<void>;
  userPools(p: Principal): Promise<UserModelPools>;
}
export class ModelCatalogService {
  constructor(
    private store: CreationStore,
    private directory: ModelDirectory,
  ) {}
  snapshot(p: Principal) {
    return this.store.read((r) => r.catalog.snapshot(p));
  }
  userPools(p: Principal) {
    return this.store.read((r) => r.catalog.userPools(p));
  }
  bootstrap(p: Principal) {
    return this.store.write({ owners: [p.id], catalog: true }, (r) =>
      r.catalog.bootstrap(p),
    );
  }
  saveService(p: Principal, input: ModelServiceInput) {
    const parsed = modelServiceInput.parse(input);
    return this.store.write({ owners: [p.id], catalog: true }, (r) =>
      r.catalog.saveService(p, parsed),
    );
  }
  async refresh(p: Principal, id: string) {
    const config = await this.store.read((r) => r.catalog.directory(p, id));
    const models = await this.directory.list(
      config,
      AbortSignal.timeout(15000),
    );
    await this.store.write({ owners: [p.id], catalog: true }, (r) =>
      r.catalog.refresh(p, id, config.versionId, models),
    );
  }
  manual(p: Principal, id: string, model: string) {
    return this.store.write({ owners: [p.id], catalog: true }, (r) =>
      r.catalog.manual(p, id, model),
    );
  }
  publish(p: Principal, input: PoolPublication) {
    const parsed = poolPublication.parse(input);
    return this.store.write({ owners: [p.id], catalog: true }, (r) =>
      r.catalog.publish(p, parsed),
    );
  }
  state(
    p: Principal,
    id: string,
    revision: number,
    enabled: boolean,
    revoke = false,
  ) {
    return this.store.write({ owners: [p.id], catalog: true }, (r) =>
      r.catalog.state(p, id, revision, enabled, revoke),
    );
  }
}
