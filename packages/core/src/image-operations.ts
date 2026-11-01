import { composeCreativePrompt } from "@tuyile/contracts";
import { createToolRegistry, defaultTool, type ToolRegistry } from "./tools.js";
import { checkImageCapability } from "./capabilities.js";
import type { ToolBinding } from "@tuyile/contracts";
import { AppError } from "./index.js";
import {
  checkImageSpec,
  type StoredAsset,
  type AssetBytes,
  type WorkItem,
} from "./creation.js";
import { checkAdmissionBudget } from "./creation-policy.js";
import type { CreationStore } from "./creation-ports.js";
import type {
  Principal,
  ImageInput,
  ImagePolicy,
  ProviderInput,
  ReviewTask,
} from "@tuyile/contracts";
export class ImageOperations {
  constructor(
    protected readonly store: CreationStore,
    protected readonly registry: ToolRegistry = createToolRegistry(),
  ) {}
  async admit(
    p: Principal,
    input: ImageInput,
    tool: ToolBinding = defaultTool(input),
  ) {
    this.registry.validate(tool, input);
    return this.store.write({ owners: [p.id], queue: true }, async (r) => {
      const existing = await r.tasks.existingAdmission(p, input, tool);
      if (existing) return existing;
      const textSources = await r.tasks.resolveTextSources(
        p,
        input.projectId,
        input.textNodeIds ?? [],
      );
      if (composeCreativePrompt({ ...input, textSources }).length > 12000)
        throw new AppError("PROMPT_TOO_LONG", 400);
      await r.extensions.registerTools(this.registry.list());
      await r.extensions.requireTool(tool);
      const provider = await r.providers.current(input);
      const snapshot = await r.quota.admission(p, input);
      checkImageSpec(
        {
          ...input,
          ...(provider.selectionId
            ? { modelSelectionId: provider.selectionId }
            : {}),
        },
        snapshot.budget.policy,
        provider.models,
      );
      checkImageCapability(input, provider.capabilities);
      checkAdmissionBudget(snapshot.budget);
      const task = await r.tasks.insert(
        p,
        input,
        snapshot,
        provider.id,
        tool,
        textSources,
      );
      await r.quota.reserve(p, task.id, snapshot);
      await r.assets.pin(p, task.id, input.referenceIds);
      return task;
    });
  }
  async tasks(p: Principal, projectId?: string, offset = 0) {
    return this.store.read((r) => r.tasks.tasks(p, projectId, offset));
  }
  async task(p: Principal, id: string) {
    return this.store.read((r) => r.tasks.task(p, id));
  }
  async recover(p: Principal, projectId: string, key: string) {
    return this.store.read((r) => r.tasks.recover(p, projectId, key));
  }
  async cancel(p: Principal, id: string) {
    return this.store.write({ owners: [p.id] }, (r) => r.tasks.cancel(p, id));
  }
  async uploads(p: Principal, offset = 0) {
    return this.store.read((r) => r.assets.uploads(p, offset));
  }
  async reserveUpload(p: Principal) {
    return this.store.write({ owners: [p.id] }, (r) =>
      r.assets.reserveUpload(p),
    );
  }
  async commitAsset(a: StoredAsset, image: AssetBytes, attemptId?: string) {
    return this.store.write({ owners: [a.userId] }, async (r) => {
      const prepared = await r.assets.prepareCommit(a, image);
      if (!prepared) return; // Lost acknowledgement after a committed publication.
      if (prepared.taskId) {
        if (!attemptId) throw new AppError("ATTEMPT_STOPPED", 409);
        const output = await r.outputs.record(prepared, attemptId);
        await r.quota.consume(output);
      }
      await r.assets.publish(prepared, image);
    });
  }
  async abandonAsset(a: StoredAsset) {
    return this.store.write({ owners: [a.userId] }, (r) =>
      r.assets.abandonAsset(a),
    );
  }
  async asset(p: Principal, id: string) {
    return this.store.read((r) => r.assets.asset(p, id));
  }
  async deleteAsset(p: Principal, id: string) {
    return this.store.write({ owners: [p.id] }, (r) =>
      r.assets.deleteAsset(p, id),
    );
  }
  async finalizeDelete(a: StoredAsset) {
    return this.store.write({ owners: [a.userId] }, (r) =>
      r.assets.finalizeDelete(a),
    );
  }
  async staleAssets() {
    return this.store.read((r) => r.assets.staleAssets());
  }
  async usage(p: Principal) {
    return this.store.read((r) => r.quota.usage(p));
  }
  async getPolicy(p: Principal, id: string) {
    return this.store.read((r) => r.quota.getPolicy(p, id));
  }
  async setPolicy(p: Principal, id: string, input: ImagePolicy) {
    return this.store.write({ owners: [p.id, id] }, (r) =>
      r.quota.setPolicy(p, id, input),
    );
  }
  async review(p: Principal): Promise<ReviewTask[]> {
    return this.store.read((r) => r.quota.review(p));
  }
  async resolve(p: Principal, id: string, confirmed: number, reason: string) {
    return this.store.write({ owners: [p.id], taskId: id }, (r) =>
      r.quota.resolve(p, id, confirmed, reason),
    );
  }
  async saveProvider(p: Principal, input: ProviderInput) {
    return this.store.write({ owners: [p.id] }, (r) =>
      r.providers.saveProvider(p, input),
    );
  }
  async providers(p: Principal) {
    return this.store.read((r) => r.providers.providers(p));
  }
  async revokeProvider(p: Principal, id: string) {
    return this.store.write({ owners: [p.id] }, (r) =>
      r.providers.revokeProvider(p, id),
    );
  }
  async startWorker() {
    return this.store.write(
      { owners: [], taskState: "unfinished", queue: true },
      (r) => r.execution.startWorker(),
    );
  }
  async claim(activeUserIds: string[], activeCount: number) {
    return this.store.write(
      { owners: [], taskState: "queued", queue: true },
      (r) => r.execution.claim(activeUserIds, activeCount),
    );
  }
  async stopRequested(t: WorkItem) {
    return this.store.read((r) => r.execution.stopRequested(t));
  }
  async dispatch(t: WorkItem, ordinal: number, retry: number) {
    this.registry.validate(t.tool, t.input);
    return this.store.write({ owners: [t.userId] }, async (r) => {
      try {
        await r.extensions.requireTool(t.tool, true);
        if (t.skillId) {
          const skill = await r.extensions.skill(t.skillId, true);
          for (const dependency of skill.tools)
            await r.extensions.requireTool(dependency, true);
        }
      } catch (e) {
        if (e instanceof AppError && e.code === "TOOL_UNAVAILABLE") return null;
        throw e;
      }
      return r.execution.dispatch(t, ordinal, retry);
    });
  }
  async attemptResult(
    id: string,
    state: "received" | "rejected" | "unknown",
    status?: number,
    code?: string,
  ) {
    return this.store.write({ owners: [], attemptId: id }, (r) =>
      r.execution.attemptResult(id, state, status, code),
    );
  }
  async references(t: WorkItem) {
    return this.store.read((r) => r.execution.references(t));
  }
  async outputIntent(t: WorkItem, ordinal: number) {
    return this.store.write({ owners: [t.userId] }, (r) =>
      r.execution.outputIntent(t, ordinal),
    );
  }
  async finish(t: WorkItem, errorCode?: string, cancelled = false) {
    return this.store.write({ owners: [t.userId] }, (r) =>
      r.execution.finish(t, errorCode, cancelled),
    );
  }
}
