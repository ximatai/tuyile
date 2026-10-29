import {
  skillInput,
  planningProviderInput,
  type Principal,
  type PlanningProviderInput,
  type PlanningProviderView,
  type SkillInput,
  type SkillView,
  type ToolBinding,
  type ToolView,
} from "@tuyile/contracts";
import { AppError } from "./index.js";
import { createToolRegistry, type ToolRegistry } from "./tools.js";
import type { CreationStore } from "./creation-ports.js";
export type PlanningExecutionConfig = Readonly<{
  mode: "fake" | "openai";
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsImages: boolean;
  responseMode: "text" | "json_object";
  maxOutputTokens: number;
  maxInputCharacters: number;
}>;
export interface PlanningReply {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface PlanningImage {
  assetId: string;
  bytes: Uint8Array;
}
export interface PlanningProvider {
  complete(
    config: PlanningExecutionConfig,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    budget: number,
    signal: AbortSignal,
    images?: readonly PlanningImage[],
  ): Promise<PlanningReply>;
}
export interface ExtensionsRepository {
  authorize(p: Principal, admin?: boolean): Promise<void>;
  savePlanning(
    p: Principal,
    input: PlanningProviderInput,
  ): Promise<PlanningProviderView>;
  planningProviders(p: Principal): Promise<PlanningProviderView[]>;
  revokePlanning(p: Principal, id: string): Promise<void>;
  planningConfig(id: string): Promise<PlanningExecutionConfig>;
  currentPlanning(): Promise<PlanningProviderView>;
  tools(): Promise<
    { id: string; version: number; enabled: boolean; revoked: boolean }[]
  >;
  requireTool(binding: ToolBinding, dispatch?: boolean): Promise<void>;
  registerTools(tools: ToolView[]): Promise<void>;
  setTool(
    p: Principal,
    binding: ToolBinding,
    enabled: boolean,
    revoked: boolean,
  ): Promise<void>;
  saveSkill(p: Principal, input: SkillInput): Promise<SkillView>;
  skills(p: Principal, admin?: boolean): Promise<SkillView[]>;
  skill(id: string, dispatch?: boolean): Promise<SkillView>;
  setSkill(
    p: Principal,
    id: string,
    enabled: boolean,
    revoked: boolean,
  ): Promise<void>;
}
export class ExtensionService {
  constructor(
    private readonly store: CreationStore,
    readonly registry: ToolRegistry = createToolRegistry(),
  ) {}
  savePlanning(p: Principal, input: PlanningProviderInput) {
    return this.store.write({ owners: [p.id], extensions: true }, (r) =>
      r.extensions.savePlanning(p, planningProviderInput.parse(input)),
    );
  }
  planningProviders(p: Principal) {
    return this.store.read((r) => r.extensions.planningProviders(p));
  }
  revokePlanning(p: Principal, id: string) {
    return this.store.write({ owners: [p.id], extensions: true }, (r) =>
      r.extensions.revokePlanning(p, id),
    );
  }
  async tools(p: Principal) {
    return this.store.read(async (r) => {
      await r.extensions.authorize(p, true);
      const states = await r.extensions.tools();
      return this.registry.list().map((t) => ({
        ...t,
        ...states.find((s) => s.id === t.id && s.version === t.version),
      }));
    });
  }
  setTool(
    p: Principal,
    binding: ToolBinding,
    enabled: boolean,
    revoked: boolean,
  ) {
    this.registry.require(binding);
    return this.store.write({ owners: [p.id], extensions: true }, async (r) => {
      await r.extensions.authorize(p, true);
      await r.extensions.registerTools(this.registry.list());
      await r.extensions.setTool(p, binding, enabled, revoked);
    });
  }
  async saveSkill(p: Principal, input: SkillInput) {
    const parsed = skillInput.parse(input);
    if (
      new Set(parsed.tools.map((t) => `${t.id}@${t.version}`)).size !==
      parsed.tools.length
    )
      throw new AppError("DUPLICATE_TOOL_DEPENDENCY", 400);
    parsed.tools.forEach((t) => this.registry.require(t));
    return this.store.write({ owners: [p.id], extensions: true }, async (r) => {
      await r.extensions.authorize(p, true);
      await r.extensions.registerTools(this.registry.list());
      if (parsed.enabled)
        for (const t of parsed.tools) await r.extensions.requireTool(t);
      return r.extensions.saveSkill(p, parsed);
    });
  }
  async skills(p: Principal, admin = false) {
    return this.store.read(async (r) => {
      const skills = await r.extensions.skills(p, admin);
      if (admin) return skills;
      const states = await r.extensions.tools();
      return skills.filter((s) =>
        s.tools.every((t) => {
          try {
            this.registry.require(t);
          } catch {
            return false;
          }
          const state = states.find(
            (x) => x.id === t.id && x.version === t.version,
          );
          return state?.enabled && !state.revoked;
        }),
      );
    });
  }
  setSkill(p: Principal, id: string, enabled: boolean, revoked: boolean) {
    return this.store.write({ owners: [p.id], extensions: true }, async (r) => {
      await r.extensions.authorize(p, true);
      const skill = await r.extensions.skill(id, true);
      if (enabled && !revoked)
        for (const t of skill.tools) {
          this.registry.require(t);
          await r.extensions.requireTool(t);
        }
      await r.extensions.setSkill(p, id, enabled, revoked);
    });
  }
}
export class PlanningCallError extends Error {
  constructor(
    readonly kind: "rejected" | "unknown",
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
  }
}
