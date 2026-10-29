import { AppError, type PlanningExecutionConfig } from "@tuyile/core";
import {
  skillInput,
  type Principal,
  type PlanningProviderInput,
  type PlanningProviderView,
  type SkillInput,
  type SkillView,
  type ToolBinding,
  type ToolView,
} from "@tuyile/contracts";
import { PgCreationContext } from "./context.js";
interface PlanningRow {
  id: string;
  mode: "fake" | "openai";
  base_url: string;
  model: string;
  secret_cipher: string;
  supports_images: boolean;
  response_mode: "text" | "json_object";
  max_output_tokens: number;
  max_input_characters: number;
  active: boolean;
  revoked: boolean;
}
interface SkillRow {
  id: string;
  definition: SkillInput;
  enabled: boolean;
  revoked: boolean;
}
const planningView = (r: PlanningRow): PlanningProviderView => ({
  id: r.id,
  mode: r.mode,
  baseUrl: r.base_url,
  model: r.model,
  supportsImages: r.mode === "fake" || r.supports_images,
  responseMode: r.response_mode,
  maxOutputTokens: r.max_output_tokens,
  maxInputCharacters: r.max_input_characters,
  active: r.active,
  revoked: r.revoked,
});
const skillView = (r: SkillRow): SkillView => ({
  ...skillInput.parse(r.definition),
  id: r.id,
  enabled: r.enabled,
  revoked: r.revoked,
});
export class PgExtensionsRepository extends PgCreationContext {
  authorize(p: Principal, admin = false) {
    return this.auth(this.c, p, admin, false);
  }
  async savePlanning(p: Principal, input: PlanningProviderInput) {
    await this.auth(this.c, p, true);
    await this.c.query("SELECT pg_advisory_xact_lock(72110406)");
    if (input.mode === "fake" && !this.fakeAllowed)
      throw new AppError("FAKE_PROVIDER_DISABLED", 403);
    if (input.mode === "openai") {
      let u: URL;
      try {
        u = new URL(input.baseUrl);
      } catch {
        throw new AppError("INVALID_PROVIDER_URL", 400);
      }
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw new AppError("INVALID_PROVIDER_URL", 400);
    }
    const current = (
      await this.c.query<PlanningRow>(
        "SELECT * FROM planning_provider_versions WHERE active",
      )
    ).rows[0];
    const baseUrl =
      input.mode === "fake" ? "" : input.baseUrl.replace(/\/$/, "");
    const key =
      input.mode === "fake"
        ? ""
        : (input.apiKey ??
          (input.preserveKey &&
          current?.mode === "openai" &&
          current.base_url === baseUrl
            ? this.decrypt(current.secret_cipher)
            : ""));
    if (input.mode === "openai" && !key)
      throw new AppError("API_KEY_REQUIRED", 400);
    await this.c.query(
      "UPDATE planning_provider_versions SET active=false WHERE active",
    );
    const r = (
      await this.c.query<PlanningRow>(
        "INSERT INTO planning_provider_versions(mode,base_url,model,secret_cipher,response_mode,max_output_tokens,max_input_characters,supports_images) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          input.mode,
          baseUrl,
          input.model,
          this.encrypt(key),
          input.responseMode,
          input.maxOutputTokens,
          input.maxInputCharacters,
          input.mode === "fake" || input.supportsImages,
        ],
      )
    ).rows[0];
    return planningView(r);
  }
  async planningProviders(p: Principal) {
    await this.auth(this.c, p, true, false);
    return (
      await this.c.query<PlanningRow>(
        "SELECT * FROM planning_provider_versions ORDER BY created_at DESC LIMIT 50",
      )
    ).rows.map(planningView);
  }
  async revokePlanning(p: Principal, id: string) {
    await this.auth(this.c, p, true);
    if (
      !(
        await this.c.query(
          "UPDATE planning_provider_versions SET active=false,revoked=true WHERE id=$1 RETURNING id",
          [id],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
  async planningConfig(id: string): Promise<PlanningExecutionConfig> {
    const r = (
      await this.c.query<PlanningRow>(
        "SELECT * FROM planning_provider_versions WHERE id=$1 FOR SHARE",
        [id],
      )
    ).rows[0];
    if (!r || r.revoked)
      throw new AppError("PLANNING_PROVIDER_UNAVAILABLE", 409);
    return {
      mode: r.mode,
      baseUrl: r.base_url,
      model: r.model,
      apiKey: this.decrypt(r.secret_cipher),
      supportsImages: r.mode === "fake" || r.supports_images,
      responseMode: r.response_mode,
      maxOutputTokens: r.max_output_tokens,
      maxInputCharacters: r.max_input_characters,
    };
  }
  async currentPlanning() {
    const r = (
      await this.c.query<PlanningRow>(
        "SELECT * FROM planning_provider_versions WHERE active AND NOT revoked",
      )
    ).rows[0];
    if (!r) throw new AppError("PLANNING_PROVIDER_NOT_CONFIGURED", 409);
    return planningView(r);
  }
  async registerTools(tools: ToolView[]) {
    for (const t of tools)
      await this.c.query(
        "INSERT INTO tool_controls(tool_id,version) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [t.id, t.version],
      );
  }
  async tools() {
    return (
      await this.c.query<{
        id: string;
        version: number;
        enabled: boolean;
        revoked: boolean;
      }>("SELECT tool_id AS id,version,enabled,revoked FROM tool_controls")
    ).rows;
  }
  async requireTool(t: ToolBinding, dispatch = false) {
    const row = (
      await this.c.query(
        "SELECT * FROM tool_controls WHERE tool_id=$1 AND version=$2 FOR SHARE",
        [t.id, t.version],
      )
    ).rows[0];
    if (!row || row.revoked || (!dispatch && !row.enabled))
      throw new AppError("TOOL_UNAVAILABLE", 409);
  }
  async setTool(
    p: Principal,
    t: ToolBinding,
    enabled: boolean,
    revoked: boolean,
  ) {
    await this.auth(this.c, p, true);
    if (
      !(
        await this.c.query(
          "UPDATE tool_controls SET enabled=$3 AND NOT (revoked OR $4),revoked=revoked OR $4 WHERE tool_id=$1 AND version=$2 RETURNING tool_id",
          [t.id, t.version, enabled, revoked],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
  async saveSkill(p: Principal, input: SkillInput) {
    await this.auth(this.c, p, true);
    await this.c.query("SELECT pg_advisory_xact_lock(72110406)");
    if (
      (
        await this.c.query(
          "SELECT 1 FROM skill_versions WHERE skill_key=$1 AND version=$2",
          [input.key, input.version],
        )
      ).rowCount
    )
      throw new AppError("SKILL_VERSION_CONFLICT", 409);
    if (input.enabled)
      await this.c.query(
        "UPDATE skill_versions SET enabled=false WHERE skill_key=$1 AND enabled",
        [input.key],
      );
    return skillView(
      (
        await this.c.query<SkillRow>(
          "INSERT INTO skill_versions(skill_key,version,definition,enabled) VALUES($1,$2,$3,$4) RETURNING *",
          [input.key, input.version, JSON.stringify(input), input.enabled],
        )
      ).rows[0],
    );
  }
  async skills(p: Principal, admin = false) {
    await this.auth(this.c, p, admin, false);
    return (
      await this.c.query<SkillRow>(
        "SELECT * FROM skill_versions WHERE ($1 OR (enabled AND NOT revoked)) ORDER BY created_at DESC LIMIT 100",
        [admin],
      )
    ).rows.map(skillView);
  }
  async skill(id: string, dispatch = false) {
    const row = (
      await this.c.query<SkillRow>(
        "SELECT * FROM skill_versions WHERE id=$1 FOR SHARE",
        [id],
      )
    ).rows[0];
    if (!row || row.revoked || (!dispatch && !row.enabled))
      throw new AppError("SKILL_UNAVAILABLE", 409);
    return skillView(row);
  }
  async setSkill(p: Principal, id: string, enabled: boolean, revoked: boolean) {
    await this.auth(this.c, p, true);
    await this.c.query("SELECT pg_advisory_xact_lock(72110406)");
    const row = (
      await this.c.query<{ skill_key: string }>(
        "SELECT skill_key FROM skill_versions WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    if (enabled && !revoked)
      await this.c.query(
        "UPDATE skill_versions SET enabled=false WHERE skill_key=$1 AND enabled",
        [row.skill_key],
      );
    await this.c.query(
      "UPDATE skill_versions SET enabled=$2 AND NOT(revoked OR $3),revoked=revoked OR $3 WHERE id=$1",
      [id, enabled, revoked],
    );
  }
}
