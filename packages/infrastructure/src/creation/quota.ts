import { PgModelCatalogRepository } from "./model-catalog.js";
import type { TaskRow } from "./rows.js";
import type { AdmissionSnapshot, OutputSettlement } from "@tuyile/core";

import {
  AppError,
  ASSET_RESERVE,
  defaultImagePolicy,
  shanghaiDay,
} from "@tuyile/core";
import type {
  Principal,
  ImageInput,
  ImagePolicy,
  ReviewTask,
} from "@tuyile/contracts";
import { PgCreationContext, policy } from "./context.js";
export class PgQuotaRepository extends PgCreationContext {
  async admission(
    p: Principal,
    input: ImageInput,
    day = shanghaiDay(this.now()),
  ): Promise<AdmissionSnapshot> {
    const c = this.c;
    const limits = await this.ensure(c, p.id, day),
      rules = policy(limits);
    const settings = (await c.query("SELECT * FROM image_settings WHERE id=1"))
      .rows[0];
    const queued = (
      await c.query(
        "SELECT count(DISTINCT coalesce(agent_plan_id,id)) AS total,count(DISTINCT coalesce(agent_plan_id,id)) FILTER(WHERE user_id=$1) AS own FROM image_tasks WHERE state='queued'",
        [p.id],
      )
    ).rows[0];
    const recent = (
      await c.query(
        "SELECT count(DISTINCT coalesce(agent_plan_id,id)) n FROM image_tasks WHERE user_id=$1 AND created_at>now()-interval '1 minute'",
        [p.id],
      )
    ).rows[0];
    const daily = (
      await c.query("SELECT * FROM image_days WHERE user_id=$1 AND day=$2", [
        p.id,
        day,
      ])
    ).rows[0];
    return {
      day,
      budget: {
        count: input.count,
        policy: rules,
        queued: Number(queued.total),
        ownQueued: Number(queued.own),
        queueLimit: settings.queue_limit,
        recentSubmissions: Number(recent.n),
        used: daily.used,
        held: daily.held,
        storageUsed: Number(limits.storage_used),
        storageReserved: Number(limits.storage_reserved),
        requiredStorage: ASSET_RESERVE * input.count,
      },
    };
  }
  async reserve(p: Principal, taskId: string, snapshot: AdmissionSnapshot) {
    const c = this.c;
    await c.query(
      "INSERT INTO image_quota_reservations(workspace_id,task_id,user_id,day,accepted,held) VALUES($1,$2,$3,$4,$5,$5)",
      [p.workspaceId, taskId, p.id, snapshot.day, snapshot.budget.count],
    );
    await c.query(
      "INSERT INTO image_quota_entries(workspace_id,task_id,user_id,day,source,kind,used_delta,held_delta,reservation_id) VALUES($1,$2,$3,$4,'admission','reserve',0,$5,(SELECT id FROM image_quota_reservations WHERE task_id=$2))",
      [p.workspaceId, taskId, p.id, snapshot.day, snapshot.budget.count],
    );
    await c.query(
      "UPDATE image_days SET held=held+$3 WHERE user_id=$1 AND day=$2",
      [p.id, snapshot.day, snapshot.budget.count],
    );
    await c.query(
      "UPDATE image_policies SET storage_reserved=storage_reserved+$2 WHERE user_id=$1",
      [p.id, snapshot.budget.requiredStorage],
    );
  }
  async consume(o: OutputSettlement) {
    await this.c.query(
      "UPDATE image_quota_reservations SET consumed=consumed+1,held=held-1 WHERE task_id=$1",
      [o.taskId],
    );
    await this.c.query(
      "INSERT INTO image_quota_entries(workspace_id,task_id,user_id,day,source,kind,used_delta,held_delta,output_id,reservation_id) VALUES($1,$2,$3,$4,$5,'consume',1,-1,$6,(SELECT id FROM image_quota_reservations WHERE task_id=$2))",
      [
        o.workspaceId,
        o.taskId,
        o.userId,
        o.day,
        `output:${o.outputId}`,
        o.outputId,
      ],
    );
    await this.c.query(
      "UPDATE image_days SET used=used+1,held=held-1 WHERE user_id=$1 AND day=$2",
      [o.userId, o.day],
    );
  }

  async usage(p: Principal) {
    const c = this.c;

    await this.auth(c, p, false, false);
    const day = shanghaiDay(this.now()),
      limits = (
        await c.query("SELECT * FROM image_policies WHERE user_id=$1", [p.id])
      ).rows[0],
      rules = limits
        ? policy(limits)
        : { ...defaultImagePolicy, allowedModels: [] },
      daily = (
        await c.query("SELECT * FROM image_days WHERE user_id=$1 AND day=$2", [
          p.id,
          day,
        ])
      ).rows[0] ?? { used: 0, held: 0, attempts: 0 },
      prov = (
        await c.query(
          "SELECT mode,models,capabilities FROM image_provider_versions WHERE active AND NOT revoked",
        )
      ).rows[0];
    const managed = (
      await c.query("SELECT managed FROM model_catalog_state WHERE id=1")
    ).rows[0].managed;
    const pools = managed
      ? await new PgModelCatalogRepository(
          c,
          this.masterKey,
          this.fakeAllowed,
          this.now,
        ).userPools(p)
      : undefined;
    return {
      day,
      ...(pools ? { modelOptions: pools.image } : {}),
      used: daily.used,
      held: daily.held,
      available: Math.max(0, rules.imageLimit - daily.used - daily.held),
      attempts: daily.attempts,
      earlierHeld: Number(
        (
          await c.query(
            "SELECT coalesce(sum(held),0) n FROM image_days WHERE user_id=$1 AND day<$2",
            [p.id, day],
          )
        ).rows[0].n,
      ),
      storageUsed: Number(limits?.storage_used ?? 0),
      storageReserved: Number(limits?.storage_reserved ?? 0),
      policy: rules,
      models: pools
        ? [...new Set(pools.image.map((e) => e.modelId))]
        : (prov?.models ?? []).filter(
            (m: string) =>
              !rules.allowedModels.length || rules.allowedModels.includes(m),
          ),
      providerMode: pools
        ? !pools.image.length
          ? null
          : (
                await c.query(
                  "SELECT bool_and(v.mode='fake') AS fake FROM model_pool_entries e JOIN model_services s ON s.id=e.service_id JOIN image_provider_versions v ON v.id=e.image_provider_id WHERE e.kind='image' AND e.enabled AND s.enabled AND NOT s.revoked",
                )
              ).rows[0].fake
            ? "fake"
            : "openai"
        : (prov?.mode ?? null),
      capabilities: pools
        ? pools.image.map((e) => e.image!)
        : (prov?.capabilities ?? []).filter(
            (c: { model: string }) =>
              !rules.allowedModels.length ||
              rules.allowedModels.includes(c.model),
          ),
    };
  }
  async getPolicy(p: Principal, id: string) {
    const c = this.c;

    await this.auth(c, p, true, false);
    if (!(await c.query("SELECT id FROM users WHERE id=$1", [id])).rowCount)
      throw new AppError("NOT_FOUND", 404);
    const row = (
      await c.query("SELECT * FROM image_policies WHERE user_id=$1", [id])
    ).rows[0];
    return row ? policy(row) : { ...defaultImagePolicy, allowedModels: [] };
  }
  async setPolicy(p: Principal, id: string, input: ImagePolicy) {
    const c = this.c;

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
  }
  async review(p: Principal): Promise<ReviewTask[]> {
    const c = this.c;

    await this.auth(c, p, true, false);
    const rows = (
      await c.query(
        "SELECT id,user_id,state,pending_review,used,held,created_at FROM image_tasks WHERE pending_review ORDER BY created_at LIMIT 100",
      )
    ).rows;
    const attempts = (
      await c.query<ReviewTask["attempts"][number] & { task_id: string }>(
        'SELECT task_id,id,state,http_status AS "httpStatus",error_code AS "errorCode" FROM image_attempts WHERE task_id=ANY($1::uuid[]) ORDER BY created_at',
        [rows.map((r) => r.id)],
      )
    ).rows;
    const byTask = new Map<string, ReviewTask["attempts"]>();
    for (const { task_id, ...attempt } of attempts) {
      const group = byTask.get(task_id) ?? [];
      group.push(attempt);
      byTask.set(task_id, group);
    }
    const results: ReviewTask[] = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      state: r.state,
      pendingReview: r.pending_review,
      used: r.used,
      held: r.held,
      createdAt: r.created_at.toISOString(),
      attempts: byTask.get(r.id) ?? [],
    }));
    return results;
  }
  async resolve(p: Principal, id: string, confirmed: number, reason: string) {
    const c = this.c;

    await this.auth(c, p, true);
    const t = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE",
        [id],
      )
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
    if (!t.pending_review || confirmed !== 0)
      throw new AppError("INVALID_RESOLUTION", 409);
    await c.query(
      "UPDATE image_quota_reservations SET released=released+held,held=0 WHERE task_id=$1",
      [id],
    );
    if (t.held > 0)
      await c.query(
        "INSERT INTO image_quota_entries(workspace_id,task_id,user_id,day,source,kind,used_delta,held_delta,reservation_id) VALUES($1,$2,$3,$4,'review','release',0,$5,(SELECT id FROM image_quota_reservations WHERE task_id=$2))",
        [t.workspace_id, t.id, t.user_id, t.day, -t.held],
      );
    await c.query(
      "UPDATE image_days SET held=held-$3 WHERE user_id=$1 AND day=$2",
      [t.user_id, t.day, t.held],
    );
    await c.query(
      "UPDATE image_tasks SET held=0,pending_review=false,resolved_at=now() WHERE id=$1",
      [id],
    );
    await c.query(
      "UPDATE image_attempts SET state='resolved' WHERE task_id=$1 AND state IN ('unknown','received','dispatched')",
      [id],
    );
    await c.query("DELETE FROM image_references WHERE task_id=$1", [id]);
    await c.query(
      "INSERT INTO image_audit(actor_id,task_id,confirmed,reason) VALUES($1,$2,$3,$4)",
      [p.id, id, confirmed, reason],
    );
  }
}
