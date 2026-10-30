import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AppError, type DirectoryConfig } from "@tuyile/core";
import {
  imageCapabilityDefaults,
  poolEntryInput,
  modelId,
  type Principal,
  type ModelServiceInput,
  type ModelServiceView,
  type PoolEntryInput,
  type PoolPublication,
  type ModelChoice,
} from "@tuyile/contracts";
import { PgCreationContext } from "./context.js";
export class PgModelCatalogRepository extends PgCreationContext {
  private async lock() {
    await this.c.query("SELECT pg_advisory_xact_lock(72110407)");
  }
  private async service(id: string) {
    const r = (
      await this.c.query(
        "SELECT s.*,v.id AS version_id,v.mode,v.base_url,v.secret_cipher FROM model_services s JOIN model_service_versions v ON v.id=s.current_version WHERE s.id=$1",
        [id],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    return r;
  }
  private view(r: any): ModelServiceView {
    return {
      id: r.id,
      revision: r.revision,
      name: r.name,
      mode: r.mode,
      baseUrl: r.base_url,
      enabled: r.enabled,
      revoked: r.revoked,
      configured: true,
      catalogUpdatedAt: r.catalog_updated_at?.toISOString() ?? null,
    };
  }
  async snapshot(p: Principal) {
    await this.auth(this.c, p, true, false);
    const state = (
      await this.c.query("SELECT * FROM model_catalog_state WHERE id=1")
    ).rows[0];
    const services = (
      await this.c.query(
        "SELECT s.*,v.mode,v.base_url FROM model_services s JOIN model_service_versions v ON v.id=s.current_version ORDER BY s.created_at,s.id",
      )
    ).rows.map((r) => this.view(r));
    const models = (
      await this.c.query(
        'SELECT service_id AS "serviceId",model_id AS "modelId",present,manual FROM service_model_catalog ORDER BY service_id,model_id',
      )
    ).rows;
    const entries = (
      await this.c.query(
        "SELECT definition FROM model_pool_entries ORDER BY kind,model_id,id",
      )
    ).rows.map((r) => poolEntryInput.parse(r.definition));
    return {
      managed: state.managed,
      testingAllowed: this.fakeAllowed,
      revision: state.revision,
      services,
      models,
      entries,
    };
  }
  async bootstrap(p: Principal) {
    await this.auth(this.c, p, true);
    await this.lock();
    if (
      (await this.c.query("SELECT managed FROM model_catalog_state WHERE id=1"))
        .rows[0].managed
    )
      return;
    const image = (
      await this.c.query(
        "SELECT * FROM image_provider_versions WHERE active AND NOT revoked",
      )
    ).rows[0];
    const conversation = (
      await this.c.query(
        "SELECT * FROM planning_provider_versions WHERE active AND NOT revoked",
      )
    ).rows[0];
    const groups = new Map<string, { id: string; version: string }>();
    for (const [kind, old] of [
      ["image", image],
      ["conversation", conversation],
    ] as const) {
      if (!old) continue;
      const plain = this.decrypt(old.secret_cipher),
        group = JSON.stringify([old.mode, old.base_url, plain]);
      let service = groups.get(group);
      if (!service) {
        const id = randomUUID(),
          version = randomUUID();
        service = { id, version };
        groups.set(group, service);
        await this.c.query(
          "INSERT INTO model_services(id,name,current_version) VALUES($1,$2,$3)",
          [id, `已有服务 ${groups.size}`, version],
        );
        await this.c.query(
          "INSERT INTO model_service_versions(id,service_id,mode,base_url,secret_cipher) VALUES($1,$2,$3,$4,$5)",
          [version, id, old.mode, old.base_url, this.encrypt(plain)],
        );
      }
      await this.c.query(
        `UPDATE ${kind === "image" ? "image_provider_versions" : "planning_provider_versions"} SET service_version_id=$2 WHERE id=$1`,
        [old.id, service.version],
      );
      const models: string[] = kind === "image" ? old.models : [old.model];
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const entry: PoolEntryInput = poolEntryInput.parse({
          id: randomUUID(),
          serviceId: service.id,
          modelId: model,
          kind,
          enabled: true,
          isDefault: i === 0,
          ...(kind === "image"
            ? {
                image:
                  old.capabilities.find((v: any) => v.model === model) ??
                  imageCapabilityDefaults(model),
              }
            : {
                conversation: {
                  supportsImages: old.mode === "fake" || old.supports_images,
                  responseMode: old.response_mode,
                  maxOutputTokens: old.max_output_tokens,
                  maxInputCharacters: old.max_input_characters,
                },
              }),
        });
        await this.c.query(
          "INSERT INTO service_model_catalog(service_id,model_id,manual) VALUES($1,$2,true) ON CONFLICT DO NOTHING",
          [service.id, model],
        );
        await this.c.query(
          "INSERT INTO model_pool_entries(id,service_id,model_id,kind,enabled,is_default,definition,image_provider_id,planning_provider_id) VALUES($1,$2,$3,$4,true,$5,$6,$7,$8)",
          [
            entry.id,
            service.id,
            model,
            kind,
            entry.isDefault,
            JSON.stringify(entry),
            kind === "image" ? old.id : null,
            kind === "conversation" ? old.id : null,
          ],
        );
      }
    }
    const policies = (
      await this.c.query(
        "SELECT user_id,allowed_models FROM image_policies WHERE jsonb_array_length(allowed_models)>0",
      )
    ).rows;
    const images = (
      await this.c.query(
        "SELECT id,model_id FROM model_pool_entries WHERE kind='image'",
      )
    ).rows;
    for (const row of policies) {
      const ids = row.allowed_models.map(
        (m: string) => images.find((e) => e.model_id === m)?.id ?? m,
      );
      await this.c.query(
        "UPDATE image_policies SET allowed_models=$2 WHERE user_id=$1",
        [row.user_id, JSON.stringify(ids)],
      );
    }
    await this.c.query(
      "UPDATE model_catalog_state SET managed=true,revision=revision+1 WHERE id=1",
    );
  }
  private validateUrl(mode: string, address: string) {
    if (mode === "fake") {
      if (!this.fakeAllowed) throw new AppError("FAKE_PROVIDER_DISABLED", 403);
      return "";
    }
    let u: URL;
    try {
      u = new URL(address);
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
    return u.href.replace(/\/$/, "");
  }
  async saveService(p: Principal, input: ModelServiceInput) {
    await this.bootstrap(p);
    const base = this.validateUrl(input.mode, input.baseUrl);
    let old = input.id ? await this.service(input.id) : null;
    if (old && (old.revoked || old.revision !== input.revision))
      throw new AppError("MODEL_SERVICE_CONFLICT", 409);
    if (
      (
        await this.c.query(
          "SELECT 1 FROM model_services WHERE lower(name)=lower($1) AND ($2::uuid IS NULL OR id<>$2)",
          [input.name, input.id ?? null],
        )
      ).rowCount
    )
      throw new AppError("MODEL_SERVICE_NAME_TAKEN", 409);
    if (
      !old &&
      Number(
        (await this.c.query("SELECT count(*) n FROM model_services")).rows[0].n,
      ) >= 20
    )
      throw new AppError("MODEL_SERVICE_LIMIT", 409);
    const key =
      input.mode === "fake"
        ? ""
        : (input.apiKey ??
          (input.preserveKey &&
          old?.mode === input.mode &&
          old.base_url === base
            ? this.decrypt(old.secret_cipher)
            : ""));
    if (input.mode === "openai" && !key)
      throw new AppError("API_KEY_REQUIRED", 400);
    const id = old?.id ?? randomUUID(),
      version = randomUUID();
    if (!old)
      await this.c.query("INSERT INTO model_services(id,name) VALUES($1,$2)", [
        id,
        input.name,
      ]);
    await this.c.query(
      "INSERT INTO model_service_versions(id,service_id,mode,base_url,secret_cipher) VALUES($1,$2,$3,$4,$5)",
      [version, id, input.mode, base, this.encrypt(key)],
    );
    await this.c.query(
      "UPDATE model_services SET name=$2,current_version=$3,revision=revision+$4,catalog_updated_at=NULL WHERE id=$1",
      [id, input.name, version, old ? 1 : 0],
    );
    const service = await this.service(id);
    const entries = (
      await this.c.query(
        "SELECT definition FROM model_pool_entries WHERE service_id=$1",
        [id],
      )
    ).rows;
    for (const row of entries) {
      const e = poolEntryInput.parse(row.definition);
      const provider = await this.executionVersion(e, service);
      await this.c.query(
        "UPDATE model_pool_entries SET image_provider_id=$2,planning_provider_id=$3 WHERE id=$1",
        [
          e.id,
          e.kind === "image" ? provider : null,
          e.kind === "conversation" ? provider : null,
        ],
      );
    }
    await this.c.query(
      "UPDATE model_catalog_state SET revision=revision+1 WHERE id=1",
    );
    return this.view(service);
  }
  async directory(p: Principal, id: string): Promise<DirectoryConfig> {
    await this.auth(this.c, p, true, false);
    const s = await this.service(id);
    if (s.revoked || !s.enabled)
      throw new AppError("MODEL_SERVICE_UNAVAILABLE", 409);
    return {
      mode: s.mode,
      baseUrl: s.base_url,
      apiKey: this.decrypt(s.secret_cipher),
      versionId: s.version_id,
    };
  }
  async refresh(p: Principal, id: string, version: string, models: string[]) {
    await this.auth(this.c, p, true);
    await this.lock();
    const s = await this.service(id);
    if (s.version_id !== version || s.revoked || !s.enabled)
      throw new AppError("MODEL_SERVICE_CONFLICT", 409);
    if (models.length > 2000) throw new AppError("MODEL_DIRECTORY_LIMIT", 409);
    await this.c.query(
      "UPDATE service_model_catalog SET present=false WHERE service_id=$1 AND NOT manual",
      [id],
    );
    for (const model of new Set(models)) {
      modelId.parse(model);
      await this.c.query(
        "INSERT INTO service_model_catalog(service_id,model_id) VALUES($1,$2) ON CONFLICT(service_id,model_id) DO UPDATE SET present=true",
        [id, model],
      );
    }
    await this.c.query(
      "UPDATE model_services SET catalog_updated_at=$2 WHERE id=$1",
      [id, this.now()],
    );
  }
  async manual(p: Principal, id: string, model: string) {
    await this.auth(this.c, p, true);
    const s = await this.service(id);
    if (s.revoked) throw new AppError("MODEL_SERVICE_UNAVAILABLE", 409);
    modelId.parse(model);
    if (
      Number(
        (
          await this.c.query(
            "SELECT count(*) n FROM service_model_catalog WHERE service_id=$1",
            [id],
          )
        ).rows[0].n,
      ) >= 2000
    )
      throw new AppError("MODEL_DIRECTORY_LIMIT", 409);
    await this.c.query(
      "INSERT INTO service_model_catalog(service_id,model_id,manual) VALUES($1,$2,true) ON CONFLICT(service_id,model_id) DO UPDATE SET manual=true",
      [id, model],
    );
  }
  private async executionVersion(e: PoolEntryInput, s: any) {
    if (e.kind === "image") {
      const r = (
        await this.c.query(
          "INSERT INTO image_provider_versions(mode,base_url,models,secret_cipher,capabilities,active,service_version_id) VALUES($1,$2,$3,$4,$5,false,$6) RETURNING id",
          [
            s.mode,
            s.base_url,
            JSON.stringify([e.modelId]),
            s.secret_cipher,
            JSON.stringify([e.image]),
            s.version_id,
          ],
        )
      ).rows[0];
      return r.id;
    }
    const c = e.conversation!;
    return (
      await this.c.query(
        "INSERT INTO planning_provider_versions(mode,base_url,model,secret_cipher,supports_images,response_mode,max_output_tokens,max_input_characters,active,service_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9) RETURNING id",
        [
          s.mode,
          s.base_url,
          e.modelId,
          s.secret_cipher,
          c.supportsImages,
          c.responseMode,
          c.maxOutputTokens,
          c.maxInputCharacters,
          s.version_id,
        ],
      )
    ).rows[0].id;
  }
  async publish(p: Principal, input: PoolPublication) {
    await this.auth(this.c, p, true);
    await this.lock();
    const state = (
      await this.c.query("SELECT * FROM model_catalog_state WHERE id=1")
    ).rows[0];
    if (!state.managed || state.revision !== input.revision)
      throw new AppError("MODEL_POOL_CONFLICT", 409);
    const oldRows = (await this.c.query("SELECT * FROM model_pool_entries"))
      .rows;
    const old = new Map(oldRows.map((r) => [r.id, r]));
    // Clear defaults first to permit an atomic swap under the unique partial index.
    await this.c.query(
      "UPDATE model_pool_entries SET enabled=false,is_default=false,definition=jsonb_set(jsonb_set(definition,'{enabled}','false'),'{isDefault}','false')",
    );
    await this.c.query(
      "DELETE FROM model_pool_entries WHERE NOT(id=ANY($1::uuid[]))",
      [input.entries.map((e) => e.id)],
    );
    for (const e of input.entries) {
      const s = await this.service(e.serviceId);
      const previous = old.get(e.id);
      const unchanged =
        previous &&
        isDeepStrictEqual(previous.definition.image, e.image) &&
        isDeepStrictEqual(previous.definition.conversation, e.conversation);
      // Revoked entries may remain closed while unrelated pools are edited.
      // They cannot be added, re-enabled or given another execution version.
      if ((s.revoked && (e.enabled || !unchanged)) || (e.enabled && !s.enabled))
        throw new AppError("MODEL_SERVICE_UNAVAILABLE", 409);
      if (
        !(
          await this.c.query(
            "SELECT 1 FROM service_model_catalog WHERE service_id=$1 AND model_id=$2",
            [e.serviceId, e.modelId],
          )
        ).rowCount
      )
        throw new AppError("MODEL_NOT_DISCOVERED", 409);
      if (
        previous &&
        (previous.service_id !== e.serviceId ||
          previous.model_id !== e.modelId ||
          previous.kind !== e.kind)
      )
        throw new AppError("MODEL_POOL_IDENTITY", 409);
      const provider = unchanged
        ? e.kind === "image"
          ? previous.image_provider_id
          : previous.planning_provider_id
        : await this.executionVersion(e, s);
      await this.c.query(
        "INSERT INTO model_pool_entries(id,service_id,model_id,kind,enabled,is_default,definition,image_provider_id,planning_provider_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET enabled=EXCLUDED.enabled,is_default=EXCLUDED.is_default,definition=EXCLUDED.definition,image_provider_id=EXCLUDED.image_provider_id,planning_provider_id=EXCLUDED.planning_provider_id",
        [
          e.id,
          e.serviceId,
          e.modelId,
          e.kind,
          e.enabled,
          e.isDefault,
          JSON.stringify(e),
          e.kind === "image" ? provider : null,
          e.kind === "conversation" ? provider : null,
        ],
      );
    }
    await this.c.query(
      "UPDATE model_catalog_state SET revision=revision+1 WHERE id=1",
    );
  }
  async state(
    p: Principal,
    id: string,
    revision: number,
    enabled: boolean,
    revoke: boolean,
  ) {
    await this.auth(this.c, p, true);
    await this.lock();
    const s = await this.service(id);
    if (s.revision !== revision || s.revoked)
      throw new AppError("MODEL_SERVICE_CONFLICT", 409);
    await this.c.query(
      "UPDATE model_services SET enabled=$2,revoked=$3,revision=revision+1 WHERE id=$1",
      [id, enabled && !revoke, revoke],
    );
    if (!enabled || revoke)
      await this.c.query(
        "UPDATE model_pool_entries SET enabled=false,is_default=false,definition=jsonb_set(jsonb_set(definition,'{enabled}','false'),'{isDefault}','false') WHERE service_id=$1",
        [id],
      );
    if (revoke)
      for (const table of [
        "image_provider_versions",
        "planning_provider_versions",
      ])
        await this.c.query(
          `UPDATE ${table} SET active=false,revoked=true WHERE service_version_id IN (SELECT id FROM model_service_versions WHERE service_id=$1)`,
          [id],
        );
    await this.c.query(
      "UPDATE model_catalog_state SET revision=revision+1 WHERE id=1",
    );
  }
  async userPools(p: Principal) {
    await this.auth(this.c, p, false, false);
    const rules =
      (
        await this.c.query(
          "SELECT allowed_models FROM image_policies WHERE user_id=$1",
          [p.id],
        )
      ).rows[0]?.allowed_models ?? [];
    const planning =
      (
        await this.c.query(
          "SELECT allowed_models FROM planning_policies WHERE user_id=$1",
          [p.id],
        )
      ).rows[0]?.allowed_models ?? [];
    const rows = (
      await this.c.query(
        "SELECT e.*,s.name FROM model_pool_entries e JOIN model_services s ON s.id=e.service_id WHERE e.enabled AND s.enabled AND NOT s.revoked ORDER BY e.is_default DESC,s.name,e.model_id,e.id",
      )
    ).rows;
    const choices: ModelChoice[] = rows
      .filter((r) => {
        const allowed = r.kind === "image" ? rules : planning;
        return !allowed.length || allowed.includes(r.id);
      })
      .map((r) => {
        const e = poolEntryInput.parse(r.definition);
        return {
          id: e.id,
          serviceId: e.serviceId,
          serviceName: r.name,
          modelId: e.modelId,
          kind: e.kind,
          isDefault: e.isDefault,
          supportsImages:
            e.kind === "image"
              ? !!e.image?.editing
              : !!e.conversation?.supportsImages,
          ...(e.image ? { image: e.image } : {}),
        };
      });
    return {
      image: choices.filter((e) => e.kind === "image"),
      conversation: choices.filter((e) => e.kind === "conversation"),
    };
  }
}
