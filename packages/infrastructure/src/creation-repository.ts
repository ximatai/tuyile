import pg from "pg";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  AppError,
  ASSET_RESERVE,
  checkImageSpec,
  shanghaiDay,
  type CreationRepository,
  type StoredAsset,
  type AssetBytes,
  type WorkItem,
} from "@tuyile/core";
import type {
  Principal,
  ImageInput,
  ImagePolicy,
  ImageTask,
  ProviderInput,
  ProviderView,
  ReviewTask,
} from "@tuyile/contracts";
const asset = (r: any): StoredAsset => ({
  id: r.id,
  workspaceId: r.workspace_id,
  userId: r.user_id,
  fileKey: r.file_key,
  state: r.state,
  mime: r.mime,
  width: r.width,
  height: r.height,
  bytes: Number(r.bytes),
  previewBytes: Number(r.preview_bytes),
  hash: r.hash,
  taskId: r.task_id,
});
function policy(r: any): ImagePolicy {
  return {
    imageLimit: r.image_limit,
    attemptsLimit: r.attempts_limit,
    storageLimit: Number(r.storage_limit),
    concurrency: r.concurrency,
    queueLimit: r.queue_limit,
    maxEdge: r.max_edge,
    maxPixels: r.max_pixels,
    maxCount: r.max_count,
    maxQuality: r.max_quality,
    allowedModels: r.allowed_models,
  };
}
export class PgCreationRepository implements CreationRepository {
  constructor(
    public pool: pg.Pool,
    private masterKey: string,
    private fakeAllowed = false,
    private now = () => new Date(),
  ) {
    if (!/^[a-f0-9]{64}$/.test(masterKey))
      throw new Error("APP_MASTER_KEY_REQUIRED");
  }
  private async tx<T>(run: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(72110403)");
      const value = await run(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private async auth(c: pg.PoolClient, p: Principal, admin = false) {
    const r = (
      await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [p.id])
    ).rows[0];
    if (!r?.enabled || r.execution_version !== p.executionVersion)
      throw new AppError("UNAUTHENTICATED", 401);
    if (admin && r.role !== "admin") throw new AppError("FORBIDDEN", 403);
    if (
      !(
        await c.query(
          "SELECT 1 FROM workspace_members WHERE user_id=$1 AND workspace_id=$2",
          [p.id, p.workspaceId],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
  private async ensure(
    c: pg.PoolClient,
    userId: string,
    day = shanghaiDay(this.now()),
  ) {
    await c.query(
      "INSERT INTO image_policies(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [userId],
    );
    await c.query(
      "INSERT INTO image_days(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [userId, day],
    );
    return (
      await c.query(
        "SELECT * FROM image_policies WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
  }
  private encrypt(key: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(this.masterKey, "hex"),
        iv,
      );
    const data = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
    return [
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      data.toString("hex"),
    ].join(".");
  }
  private decrypt(value: string) {
    const [iv, tag, data] = value.split(".");
    const c = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(this.masterKey, "hex"),
      Buffer.from(iv, "hex"),
    );
    c.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([
      c.update(Buffer.from(data, "hex")),
      c.final(),
    ]).toString("utf8");
  }
  private async dto(c: pg.PoolClient, r: any): Promise<ImageTask> {
    const outputs = (
      await c.query(
        "SELECT * FROM image_assets WHERE task_id=$1 AND (state='ready' OR (state='deleted' AND hash IS NOT NULL)) ORDER BY ordinal",
        [r.id],
      )
    ).rows;
    return {
      id: r.id,
      projectId: r.project_id,
      requestKey: r.request_key,
      state: r.state,
      prompt: r.input.prompt,
      model: r.input.model,
      count: r.input.count,
      used: r.used,
      held: r.held,
      pendingReview: r.pending_review,
      cancelRequested: r.cancel_requested,
      errorCode: r.error_code,
      createdAt: r.created_at.toISOString(),
      outputs: outputs.map((a) => ({
        id: a.id,
        deleted: a.state === "deleted",
        mime: a.mime,
        width: a.width,
        height: a.height,
        bytes: Number(a.bytes),
        createdAt: a.created_at.toISOString(),
      })),
    };
  }
  async admit(p: Principal, input: ImageInput) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const project = (
        await c.query(
          "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [p.workspaceId, input.projectId],
        )
      ).rows[0];
      if (!project) throw new AppError("NOT_FOUND", 404);
      const hash = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const old = (
        await c.query(
          "SELECT * FROM image_tasks WHERE workspace_id=$1 AND project_id=$2 AND request_key=$3",
          [p.workspaceId, input.projectId, input.requestKey],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash)
          throw new AppError("IDEMPOTENCY_CONFLICT", 409);
        return this.dto(c, old);
      }
      const provider = (
        await c.query(
          "SELECT * FROM image_provider_versions WHERE active AND NOT revoked",
        )
      ).rows[0];
      if (!provider) throw new AppError("PROVIDER_NOT_CONFIGURED", 409);
      const day = shanghaiDay(this.now()),
        limits = await this.ensure(c, p.id, day),
        rules = policy(limits);
      checkImageSpec(input, rules, provider.models);
      const settings = (
        await c.query("SELECT * FROM image_settings WHERE id=1")
      ).rows[0];
      const queued = (
        await c.query(
          "SELECT count(*) AS total,count(*) FILTER(WHERE user_id=$1) AS own FROM image_tasks WHERE state='queued'",
          [p.id],
        )
      ).rows[0];
      if (
        Number(queued.total) >= settings.queue_limit ||
        Number(queued.own) >= rules.queueLimit
      )
        throw new AppError("QUEUE_FULL", 429);
      if (
        Number(
          (
            await c.query(
              "SELECT count(*) n FROM image_tasks WHERE user_id=$1 AND created_at>now()-interval '1 minute'",
              [p.id],
            )
          ).rows[0].n,
        ) >= 6
      )
        throw new AppError("SUBMISSION_RATE", 429);
      const daily = (
        await c.query("SELECT * FROM image_days WHERE user_id=$1 AND day=$2", [
          p.id,
          day,
        ])
      ).rows[0];
      if (daily.used + daily.held + input.count > rules.imageLimit)
        throw new AppError("IMAGE_QUOTA", 409);
      if (
        Number(limits.storage_used) +
          Number(limits.storage_reserved) +
          ASSET_RESERVE * input.count >
        rules.storageLimit
      )
        throw new AppError("STORAGE_QUOTA", 409);
      for (const id of new Set(input.referenceIds)) {
        const r = (
          await c.query(
            "SELECT * FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state='ready' FOR UPDATE",
            [p.workspaceId, id],
          )
        ).rows[0];
        if (!r) throw new AppError("REFERENCE_UNAVAILABLE", 404);
      }
      const task = (
        await c.query(
          "INSERT INTO image_tasks(workspace_id,project_id,user_id,execution_version,request_key,input_hash,input,policy,provider_id,day,held,storage_remaining,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
          [
            p.workspaceId,
            input.projectId,
            p.id,
            p.executionVersion,
            input.requestKey,
            hash,
            JSON.stringify(input),
            JSON.stringify(rules),
            provider.id,
            day,
            input.count,
            ASSET_RESERVE * input.count,
            new Date(this.now().getTime() + 30 * 60000),
          ],
        )
      ).rows[0];
      await c.query(
        "UPDATE image_days SET held=held+$3 WHERE user_id=$1 AND day=$2",
        [p.id, day, input.count],
      );
      await c.query(
        "UPDATE image_policies SET storage_reserved=storage_reserved+$2 WHERE user_id=$1",
        [p.id, ASSET_RESERVE * input.count],
      );
      for (const id of new Set(input.referenceIds))
        await c.query(
          "INSERT INTO image_references(workspace_id,task_id,asset_id) VALUES($1,$2,$3)",
          [p.workspaceId, task.id, id],
        );
      return this.dto(c, task);
    });
  }
  async tasks(p: Principal, projectId?: string, offset = 0) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const rows = (
        await c.query(
          "SELECT * FROM image_tasks WHERE workspace_id=$1 AND ($2::uuid IS NULL OR project_id=$2) ORDER BY created_at DESC,id LIMIT 51 OFFSET $3",
          [p.workspaceId, projectId ?? null, offset],
        )
      ).rows;
      const tasks: ImageTask[] = [];
      for (const r of rows) tasks.push(await this.dto(c, r));
      return tasks;
    });
  }
  async task(p: Principal, id: string) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const r = (
        await c.query(
          "SELECT * FROM image_tasks WHERE workspace_id=$1 AND id=$2",
          [p.workspaceId, id],
        )
      ).rows[0];
      if (!r) throw new AppError("NOT_FOUND", 404);
      return this.dto(c, r);
    });
  }
  async recover(p: Principal, projectId: string, key: string) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const r = (
        await c.query(
          "SELECT * FROM image_tasks WHERE workspace_id=$1 AND project_id=$2 AND request_key=$3",
          [p.workspaceId, projectId, key],
        )
      ).rows[0];
      if (!r) throw new AppError("NOT_FOUND", 404);
      return this.dto(c, r);
    });
  }
  async usage(p: Principal) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const day = shanghaiDay(this.now()),
        limits = await this.ensure(c, p.id, day),
        daily = (
          await c.query(
            "SELECT * FROM image_days WHERE user_id=$1 AND day=$2",
            [p.id, day],
          )
        ).rows[0],
        prov = (
          await c.query(
            "SELECT mode,models FROM image_provider_versions WHERE active AND NOT revoked",
          )
        ).rows[0];
      return {
        day,
        used: daily.used,
        held: daily.held,
        available: Math.max(0, limits.image_limit - daily.used - daily.held),
        attempts: daily.attempts,
        earlierHeld: Number(
          (
            await c.query(
              "SELECT coalesce(sum(held),0) n FROM image_days WHERE user_id=$1 AND day<$2",
              [p.id, day],
            )
          ).rows[0].n,
        ),
        storageUsed: Number(limits.storage_used),
        storageReserved: Number(limits.storage_reserved),
        policy: policy(limits),
        models: (prov?.models ?? []).filter(
          (m: string) =>
            !limits.allowed_models.length || limits.allowed_models.includes(m),
        ),
        providerMode: prov?.mode ?? null,
      };
    });
  }
  private async release(c: pg.PoolClient, t: any, keep: number) {
    const released = t.held - keep;
    await c.query(
      "UPDATE image_days SET held=held-$3 WHERE user_id=$1 AND day=$2",
      [t.user_id, t.day, released],
    );
    await c.query(
      "UPDATE image_policies SET storage_reserved=storage_reserved-$2 WHERE user_id=$1",
      [t.user_id, Number(t.storage_remaining)],
    );
    await c.query(
      "UPDATE image_tasks SET held=$2,storage_remaining=0,pending_review=$3 WHERE id=$1",
      [t.id, keep, keep > 0],
    );
    if (!keep)
      await c.query("DELETE FROM image_references WHERE task_id=$1", [t.id]);
  }
  private async finishRow(
    c: pg.PoolClient,
    t: any,
    code?: string,
    cancelled = false,
  ) {
    if (!["queued", "running"].includes(t.state)) return;
    const unknown = Number(
      (
        await c.query(
          "SELECT count(*) n FROM image_attempts WHERE task_id=$1 AND state IN ('dispatched','received','unknown')",
          [t.id],
        )
      ).rows[0].n,
    );
    const keep = Math.min(t.held, unknown);
    await c.query(
      "UPDATE image_attempts SET state='unknown',error_code=coalesce(error_code,'RESULT_UNKNOWN') WHERE task_id=$1 AND state IN ('dispatched','received')",
      [t.id],
    );
    await this.release(c, t, keep);
    const state =
      t.used === t.input.count
        ? "succeeded"
        : t.used > 0
          ? "partial"
          : cancelled && !keep
            ? "cancelled"
            : "failed";
    await c.query(
      "UPDATE image_tasks SET state=$2,error_code=$3,finished_at=now() WHERE id=$1",
      [
        t.id,
        state,
        state === "succeeded"
          ? null
          : keep
            ? "RESULT_UNKNOWN"
            : (code ?? (cancelled ? "CANCELLED" : null)),
      ],
    );
  }
  async cancel(p: Principal, id: string) {
    await this.tx(async (c) => {
      await this.auth(c, p);
      const t = (
        await c.query(
          "SELECT * FROM image_tasks WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [id, p.workspaceId],
        )
      ).rows[0];
      if (!t) throw new AppError("NOT_FOUND", 404);
      if (["queued", "running"].includes(t.state)) {
        await c.query(
          "UPDATE image_tasks SET cancel_requested=true WHERE id=$1",
          [id],
        );
        if (t.state === "queued") await this.finishRow(c, t, "CANCELLED", true);
      }
    });
  }
  async uploads(p: Principal, offset = 0) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      return (
        await c.query(
          "SELECT * FROM image_assets WHERE workspace_id=$1 AND task_id IS NULL AND state='ready' ORDER BY created_at DESC,id LIMIT 51 OFFSET $2",
          [p.workspaceId, offset],
        )
      ).rows.map(asset);
    });
  }
  async reserveUpload(p: Principal) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const limits = await this.ensure(c, p.id);
      if (
        Number(limits.storage_used) +
          Number(limits.storage_reserved) +
          ASSET_RESERVE >
        Number(limits.storage_limit)
      )
        throw new AppError("STORAGE_QUOTA", 409);
      await c.query(
        "UPDATE image_policies SET storage_reserved=storage_reserved+$2 WHERE user_id=$1",
        [p.id, ASSET_RESERVE],
      );
      return asset(
        (
          await c.query(
            "INSERT INTO image_assets(workspace_id,user_id,state,reserved_bytes) VALUES($1,$2,'staging',$3) RETURNING *",
            [p.workspaceId, p.id, ASSET_RESERVE],
          )
        ).rows[0],
      );
    });
  }
  async commitAsset(a: StoredAsset, image: AssetBytes, attemptId?: string) {
    await this.tx(async (c) => {
      const row = (
        await c.query("SELECT * FROM image_assets WHERE id=$1 FOR UPDATE", [
          a.id,
        ])
      ).rows[0];
      if (row?.state === "ready") return;
      if (row?.state !== "staging")
        throw new AppError("ASSET_WRITE_EXPIRED", 409);
      if (
        image.original.length + image.preview.length >
        Number(row.reserved_bytes)
      )
        throw new AppError("STORAGE_QUOTA", 409);
      if (a.taskId) {
        const t = (
          await c.query("SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE", [
            a.taskId,
          ])
        ).rows[0];
        if (t.state !== "running" || t.resolved_at)
          throw new AppError("TASK_STOPPED", 409);
        const attempt = (
          await c.query(
            "SELECT * FROM image_attempts WHERE id=$1 AND task_id=$2",
            [attemptId, a.taskId],
          )
        ).rows[0];
        if (attempt?.state !== "received")
          throw new AppError("ATTEMPT_STOPPED", 409);
        await c.query(
          "UPDATE image_attempts SET state='succeeded' WHERE id=$1",
          [attemptId],
        );
        await c.query(
          "UPDATE image_tasks SET used=used+1,held=held-1 WHERE id=$1",
          [a.taskId],
        );
        await c.query(
          "UPDATE image_days SET used=used+1,held=held-1 WHERE user_id=$1 AND day=$2",
          [t.user_id, t.day],
        );
      }
      await c.query(
        "UPDATE image_assets SET state='ready',mime=$2,width=$3,height=$4,bytes=$5,preview_bytes=$6,hash=$7,reserved_bytes=0 WHERE id=$1",
        [
          a.id,
          image.mime,
          image.width,
          image.height,
          image.original.length,
          image.preview.length,
          image.hash,
        ],
      );
      await c.query(
        "UPDATE image_policies SET storage_used=storage_used+$2,storage_reserved=storage_reserved-$3 WHERE user_id=$1",
        [
          a.userId,
          image.original.length + image.preview.length,
          Number(row.reserved_bytes),
        ],
      );
    });
  }
  async abandonAsset(a: StoredAsset) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE image_assets SET state='deleting' WHERE id=$1 AND state='staging' RETURNING id",
        [a.id],
      );
      return !!r.rowCount;
    });
  }
  async asset(p: Principal, id: string) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const r = (
        await c.query(
          "SELECT * FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state='ready'",
          [p.workspaceId, id],
        )
      ).rows[0];
      if (!r) throw new AppError("NOT_FOUND", 404);
      return asset(r);
    });
  }
  async deleteAsset(p: Principal, id: string) {
    return this.tx(async (c) => {
      await this.auth(c, p);
      const r = (
        await c.query(
          "SELECT * FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state IN ('ready','deleting') FOR UPDATE",
          [p.workspaceId, id],
        )
      ).rows[0];
      if (!r) throw new AppError("NOT_FOUND", 404);
      if (
        (
          await c.query(
            "SELECT 1 FROM image_references WHERE asset_id=$1 LIMIT 1",
            [id],
          )
        ).rowCount
      )
        throw new AppError("ASSET_REFERENCED", 409);
      await c.query("UPDATE image_assets SET state='deleting' WHERE id=$1", [
        id,
      ]);
      return asset(r);
    });
  }
  async finalizeDelete(a: StoredAsset) {
    await this.tx(async (c) => {
      const r = (
        await c.query(
          "SELECT * FROM image_assets WHERE id=$1 AND state='deleting' FOR UPDATE",
          [a.id],
        )
      ).rows[0];
      if (!r) return;
      await c.query(
        "UPDATE image_policies SET storage_used=storage_used-$2,storage_reserved=storage_reserved-$3 WHERE user_id=$1",
        [
          r.user_id,
          Number(r.bytes) + Number(r.preview_bytes),
          Number(r.reserved_bytes),
        ],
      );
      await c.query(
        "UPDATE image_assets SET state='deleted',bytes=0,preview_bytes=0,reserved_bytes=0 WHERE id=$1",
        [a.id],
      );
    });
  }
  async saveProvider(p: Principal, input: ProviderInput) {
    return this.tx(async (c) => {
      await this.auth(c, p, true);
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
        await c.query("SELECT * FROM image_provider_versions WHERE active")
      ).rows[0];
      const secret =
        input.mode === "fake"
          ? ""
          : (input.apiKey ??
            (input.preserveKey &&
            current &&
            current.mode === "openai" &&
            current.base_url === input.baseUrl.replace(/\/$/, "")
              ? this.decrypt(current.secret_cipher)
              : ""));
      if (input.mode === "openai" && !secret)
        throw new AppError("API_KEY_REQUIRED", 400);
      if (current)
        await c.query(
          "UPDATE image_provider_versions SET active=false WHERE id=$1",
          [current.id],
        );
      const r = (
        await c.query(
          "INSERT INTO image_provider_versions(mode,base_url,models,secret_cipher) VALUES($1,$2,$3,$4) RETURNING *",
          [
            input.mode,
            input.mode === "fake" ? "" : input.baseUrl.replace(/\/$/, ""),
            JSON.stringify([...new Set(input.models)]),
            this.encrypt(secret),
          ],
        )
      ).rows[0];
      return this.providerView(r);
    });
  }
  private providerView(r: any): ProviderView {
    return {
      id: r.id,
      mode: r.mode,
      baseUrl: r.base_url,
      models: r.models,
      active: r.active,
      revoked: r.revoked,
      configured: true,
    };
  }
  async providers(p: Principal) {
    return this.tx(async (c) => {
      await this.auth(c, p, true);
      return (
        await c.query(
          "SELECT id,mode,base_url,models,active,revoked FROM image_provider_versions ORDER BY created_at DESC LIMIT 50",
        )
      ).rows.map((r) => this.providerView(r));
    });
  }
  async revokeProvider(p: Principal, id: string) {
    await this.tx(async (c) => {
      await this.auth(c, p, true);
      if (
        !(
          await c.query(
            "UPDATE image_provider_versions SET revoked=true,active=false WHERE id=$1 RETURNING id",
            [id],
          )
        ).rowCount
      )
        throw new AppError("NOT_FOUND", 404);
    });
  }
  async getPolicy(p: Principal, id: string) {
    return this.tx(async (c) => {
      await this.auth(c, p, true);
      if (!(await c.query("SELECT id FROM users WHERE id=$1", [id])).rowCount)
        throw new AppError("NOT_FOUND", 404);
      return policy(await this.ensure(c, id));
    });
  }
  async setPolicy(p: Principal, id: string, input: ImagePolicy) {
    await this.tx(async (c) => {
      await this.auth(c, p, true);
      if (
        !(await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]))
          .rowCount
      )
        throw new AppError("NOT_FOUND", 404);
      await this.ensure(c, id);
      await c.query(
        "UPDATE image_policies SET image_limit=$2,attempts_limit=$3,storage_limit=$4,concurrency=$5,queue_limit=$6,max_edge=$7,max_pixels=$8,max_count=$9,max_quality=$10,allowed_models=$11 WHERE user_id=$1",
        [
          id,
          input.imageLimit,
          input.attemptsLimit,
          input.storageLimit,
          input.concurrency,
          input.queueLimit,
          input.maxEdge,
          input.maxPixels,
          input.maxCount,
          input.maxQuality,
          JSON.stringify(input.allowedModels),
        ],
      );
    });
  }
  async review(p: Principal): Promise<ReviewTask[]> {
    return this.tx(async (c) => {
      await this.auth(c, p, true);
      const rows = (
        await c.query(
          "SELECT id,user_id,state,pending_review,used,held,created_at FROM image_tasks WHERE pending_review ORDER BY created_at LIMIT 100",
        )
      ).rows;
      const results: ReviewTask[] = [];
      for (const r of rows)
        results.push({
          id: r.id,
          userId: r.user_id,
          state: r.state,
          pendingReview: r.pending_review,
          used: r.used,
          held: r.held,
          createdAt: r.created_at.toISOString(),
          attempts: (
            await c.query(
              'SELECT id,state,http_status AS "httpStatus",error_code AS "errorCode" FROM image_attempts WHERE task_id=$1 ORDER BY created_at',
              [r.id],
            )
          ).rows,
        });
      return results;
    });
  }
  async resolve(p: Principal, id: string, confirmed: number, reason: string) {
    await this.tx(async (c) => {
      await this.auth(c, p, true);
      const t = (
        await c.query("SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!t) throw new AppError("NOT_FOUND", 404);
      const old = (
        await c.query(
          "SELECT confirmed,reason FROM image_audit WHERE task_id=$1",
          [id],
        )
      ).rows[0];
      if (old) {
        if (old.confirmed !== confirmed || old.reason !== reason)
          throw new AppError("RESOLUTION_CONFLICT", 409);
        return;
      }
      if (!t.pending_review || confirmed > t.held)
        throw new AppError("INVALID_RESOLUTION", 409);
      await c.query(
        "UPDATE image_days SET used=used+$3,held=held-$4 WHERE user_id=$1 AND day=$2",
        [t.user_id, t.day, confirmed, t.held],
      );
      await c.query(
        "UPDATE image_tasks SET used=used+$2,held=0,pending_review=false,resolved_at=now() WHERE id=$1",
        [id, confirmed],
      );
      await c.query(
        "UPDATE image_attempts SET state='resolved' WHERE task_id=$1 AND state='unknown'",
        [id],
      );
      await c.query("DELETE FROM image_references WHERE task_id=$1", [id]);
      await c.query(
        "INSERT INTO image_audit(actor_id,task_id,confirmed,reason) VALUES($1,$2,$3,$4)",
        [p.id, id, confirmed, reason],
      );
    });
  }
  async startWorker() {
    await this.tx(async (c) => {
      const tasks = (
        await c.query(
          "SELECT * FROM image_tasks WHERE state='running' FOR UPDATE",
        )
      ).rows;
      for (const t of tasks) await this.finishRow(c, t, "WORKER_INTERRUPTED");
    });
  }
  async claim(activeUserIds: string[], activeCount: number) {
    return this.tx(async (c) => {
      const settings = (
        await c.query("SELECT * FROM image_settings WHERE id=1")
      ).rows[0];
      if (activeCount >= settings.concurrency) return null;
      const rows = (
        await c.query(
          "SELECT t.*,u.enabled,u.execution_version AS current_version FROM image_tasks t JOIN users u ON u.id=t.user_id WHERE state='queued' ORDER BY t.created_at,t.id LIMIT 100",
        )
      ).rows;
      for (const t of rows) {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          t.user_id,
        ]);
        if (
          !t.enabled ||
          t.current_version !== t.execution_version ||
          t.cancel_requested ||
          t.deadline <= this.now()
        ) {
          await this.finishRow(
            c,
            t,
            t.deadline <= this.now() ? "TASK_EXPIRED" : "AUTHORIZATION_REVOKED",
            true,
          );
          continue;
        }
        const n = activeUserIds.filter((id) => id === t.user_id).length;
        if (n >= t.policy.concurrency) continue;
        if (
          (
            await c.query(
              "UPDATE image_tasks SET state='running',started_at=now() WHERE id=$1 AND state='queued' RETURNING id",
              [t.id],
            )
          ).rowCount
        )
          return {
            id: t.id,
            userId: t.user_id,
            workspaceId: t.workspace_id,
            input: t.input,
            deadline: t.deadline,
            providerId: t.provider_id,
          };
      }
      return null;
    });
  }
  async stopRequested(t: WorkItem) {
    return this.tx(async (c) => {
      const r = (
        await c.query(
          "SELECT t.*,u.enabled,u.execution_version AS current_version,p.revoked FROM image_tasks t JOIN users u ON u.id=t.user_id JOIN image_provider_versions p ON p.id=t.provider_id WHERE t.id=$1",
          [t.id],
        )
      ).rows[0];
      return (
        !r ||
        r.state !== "running" ||
        r.cancel_requested ||
        !r.enabled ||
        r.current_version !== r.execution_version ||
        r.revoked ||
        r.deadline <= this.now()
      );
    });
  }
  async dispatch(t: WorkItem, ordinal: number, retry: number) {
    return this.tx(async (c) => {
      const u = (
          await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
            t.userId,
          ])
        ).rows[0],
        task = (
          await c.query("SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE", [
            t.id,
          ])
        ).rows[0],
        provider = (
          await c.query("SELECT * FROM image_provider_versions WHERE id=$1", [
            t.providerId,
          ])
        ).rows[0];
      if (
        !u.enabled ||
        u.execution_version !== task.execution_version ||
        task.cancel_requested ||
        task.state !== "running" ||
        task.deadline <= this.now() ||
        provider.revoked
      )
        return null;
      const day = shanghaiDay(this.now()),
        limits = await this.ensure(c, t.userId, day),
        daily = (
          await c.query(
            "SELECT * FROM image_days WHERE user_id=$1 AND day=$2",
            [t.userId, day],
          )
        ).rows[0];
      if (daily.attempts >= limits.attempts_limit)
        throw new AppError("ATTEMPT_LIMIT", 409);
      const row = (
        await c.query(
          "INSERT INTO image_attempts(workspace_id,task_id,ordinal,retry,state) VALUES($1,$2,$3,$4,'dispatched') RETURNING id",
          [t.workspaceId, t.id, ordinal, retry],
        )
      ).rows[0];
      await c.query(
        "UPDATE image_days SET attempts=attempts+1 WHERE user_id=$1 AND day=$2",
        [t.userId, day],
      );
      return {
        attemptId: row.id,
        provider: {
          mode: provider.mode,
          baseUrl: provider.base_url,
          models: provider.models,
          apiKey: this.decrypt(provider.secret_cipher),
          preserveKey: false,
        },
      };
    });
  }
  async attemptResult(
    id: string,
    state: "received" | "rejected" | "unknown",
    status?: number,
    code?: string,
  ) {
    await this.tx(async (c) => {
      await c.query(
        "UPDATE image_attempts SET state=$2,http_status=$3,error_code=$4 WHERE id=$1 AND state NOT IN ('succeeded','resolved')",
        [id, state, status ?? null, code ?? null],
      );
    });
  }
  async references(t: WorkItem) {
    return this.tx(async (c) =>
      (
        await c.query(
          "SELECT a.* FROM image_references r JOIN image_assets a ON a.workspace_id=r.workspace_id AND a.id=r.asset_id WHERE r.task_id=$1 AND a.state='ready'",
          [t.id],
        )
      ).rows.map(asset),
    );
  }
  async outputIntent(t: WorkItem, ordinal: number) {
    return this.tx(async (c) => {
      const row = (
        await c.query("SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE", [
          t.id,
        ])
      ).rows[0];
      if (
        row.state !== "running" ||
        Number(row.storage_remaining) < ASSET_RESERVE
      )
        throw new AppError("TASK_STOPPED", 409);
      const a = (
        await c.query(
          "INSERT INTO image_assets(workspace_id,user_id,task_id,ordinal,state,reserved_bytes) VALUES($1,$2,$3,$4,'staging',$5) RETURNING *",
          [t.workspaceId, t.userId, t.id, ordinal, ASSET_RESERVE],
        )
      ).rows[0];
      await c.query(
        "UPDATE image_tasks SET storage_remaining=storage_remaining-$2 WHERE id=$1",
        [t.id, ASSET_RESERVE],
      );
      return asset(a);
    });
  }
  async finish(t: WorkItem, errorCode?: string, cancelled = false) {
    await this.tx(async (c) => {
      const row = (
        await c.query("SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE", [
          t.id,
        ])
      ).rows[0];
      if (row) await this.finishRow(c, row, errorCode, cancelled);
    });
  }
  async staleAssets() {
    return this.tx(async (c) =>
      (
        await c.query(
          "SELECT * FROM image_assets WHERE state='deleting' OR (state='staging' AND created_at<now()-interval '10 minutes') LIMIT 100",
        )
      ).rows.map(asset),
    );
  }
}
