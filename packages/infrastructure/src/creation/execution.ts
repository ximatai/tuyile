import { checkImageCapability } from "@tuyile/core";
import type { TaskRow, AssetRow } from "./rows.js";
import {
  AppError,
  ASSET_RESERVE,
  shanghaiDay,
  type WorkItem,
  type ImageExecutionConfig,
} from "@tuyile/core";

import { PgCreationContext, asset } from "./context.js";
export class PgExecutionRepository extends PgCreationContext {
  async startWorker() {
    const c = this.c;

    const tasks = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE state='running' FOR UPDATE",
      )
    ).rows;
    for (const t of tasks) await this.finishRow(c, t, "WORKER_INTERRUPTED");
    const remainder = (
      await c.query<TaskRow>(
        "SELECT t.* FROM image_tasks t JOIN agent_plans p ON p.id=t.agent_plan_id WHERE t.state='queued' AND p.started_at IS NOT NULL ORDER BY t.user_id,t.id FOR UPDATE OF t",
      )
    ).rows;
    for (const t of remainder) await this.finishRow(c, t, "WORKER_INTERRUPTED");
  }
  async claim(activeUserIds: string[], activeCount: number) {
    const c = this.c;

    const settings = (await c.query("SELECT * FROM image_settings WHERE id=1"))
      .rows[0];
    if (activeCount >= settings.concurrency) return null;
    const rows = (
      await c.query<
        TaskRow & {
          enabled: boolean;
          current_version: number;
          revoked: boolean;
          tool_revoked: boolean;
          skill_revoked: boolean;
        }
      >(
        "SELECT t.*,u.enabled,u.execution_version AS current_version FROM image_tasks t JOIN users u ON u.id=t.user_id WHERE state='queued' AND (t.depends_on IS NULL OR NOT EXISTS(SELECT 1 FROM image_tasks predecessor WHERE predecessor.id=t.depends_on AND predecessor.state IN ('queued','running'))) ORDER BY t.created_at,t.id LIMIT 100",
      )
    ).rows;
    for (const t of rows) {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [t.user_id]);
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

      let effectiveInput = t.input;
      if (t.depends_on) {
        const parent = (
          await c.query("SELECT state FROM image_tasks WHERE id=$1", [
            t.depends_on,
          ])
        ).rows[0];
        if (parent && ["queued", "running"].includes(parent.state)) continue;
        if (parent?.state !== "succeeded") {
          await this.finishRow(c, t, "DEPENDENCY_FAILED", true);
          continue;
        }
        const plan = (
          await c.query("SELECT document FROM agent_plans WHERE id=$1", [
            t.agent_plan_id,
          ])
        ).rows[0];
        if (plan.document.steps[t.step_index!].usePrevious) {
          const output = (
            await c.query(
              "SELECT a.id FROM image_outputs o JOIN image_assets a ON a.id=o.asset_id WHERE o.task_id=$1 AND o.ordinal=0 AND a.state='ready' FOR UPDATE OF a",
              [t.depends_on],
            )
          ).rows[0];
          if (!output) {
            await this.finishRow(c, t, "REFERENCE_UNAVAILABLE");
            continue;
          }
          effectiveInput = {
            ...t.input,
            referenceIds: [...t.input.referenceIds, output.id],
          };
          await c.query(
            "INSERT INTO image_references(workspace_id,task_id,asset_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [t.workspace_id, t.id, output.id],
          );
        }
      }
      const n = activeUserIds.filter((id) => id === t.user_id).length;
      if (n >= t.policy.concurrency) continue;
      let skillId: string | null = null;
      if (t.agent_plan_id) {
        const plan = (
          await c.query(
            "UPDATE agent_plans SET started_at=coalesce(started_at,$2) WHERE id=$1 RETURNING job_id",
            [t.agent_plan_id, this.now()],
          )
        ).rows[0];
        skillId = (
          await c.query("SELECT skill_id FROM planning_jobs WHERE id=$1", [
            plan.job_id,
          ])
        ).rows[0].skill_id;
      }
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
          input: effectiveInput,
          skillId,
          deadline: t.deadline,
          providerId: t.provider_id,
          tool: { id: t.tool_id, version: t.tool_version },
        };
    }
    return null;
  }
  async stopRequested(t: WorkItem) {
    const c = this.c;

    const r = (
      await c.query<
        TaskRow & {
          enabled: boolean;
          current_version: number;
          revoked: boolean;
          tool_revoked: boolean;
          skill_revoked: boolean;
        }
      >(
        "SELECT t.*,u.enabled,u.execution_version AS current_version,p.revoked,tc.revoked AS tool_revoked,EXISTS(SELECT 1 FROM agent_plans ap JOIN planning_jobs j ON j.id=ap.job_id JOIN skill_versions s ON s.id=j.skill_id WHERE ap.id=t.agent_plan_id AND s.revoked) AS skill_revoked FROM image_tasks t JOIN users u ON u.id=t.user_id JOIN image_provider_versions p ON p.id=t.provider_id JOIN tool_controls tc ON tc.tool_id=t.tool_id AND tc.version=t.tool_version WHERE t.id=$1",
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
      r.tool_revoked ||
      r.skill_revoked ||
      r.deadline <= this.now()
    );
  }
  async dispatch(t: WorkItem, ordinal: number, retry: number) {
    const c = this.c;

    const u = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [t.userId])
      ).rows[0],
      task = (
        await c.query<TaskRow>(
          "SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE",
          [t.id],
        )
      ).rows[0],
      provider = (
        await c.query(
          "SELECT * FROM image_provider_versions WHERE id=$1 FOR SHARE",
          [t.providerId],
        )
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
    checkImageCapability(t.input, provider.capabilities);
    const day = shanghaiDay(this.now()),
      limits = await this.ensure(c, t.userId, day),
      daily = (
        await c.query("SELECT * FROM image_days WHERE user_id=$1 AND day=$2", [
          t.userId,
          day,
        ])
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
      provider: (provider.mode === "fake"
        ? { mode: "fake" }
        : {
            mode: "openai",
            baseUrl: provider.base_url,
            apiKey: this.decrypt(provider.secret_cipher),
          }) satisfies ImageExecutionConfig,
    };
  }
  async attemptResult(
    id: string,
    state: "received" | "rejected" | "unknown",
    status?: number,
    code?: string,
  ) {
    const c = this.c;

    await c.query(
      "UPDATE image_attempts SET state=$2,http_status=$3,error_code=$4 WHERE id=$1 AND state NOT IN ('succeeded','resolved')",
      [id, state, status ?? null, code ?? null],
    );
  }
  async references(t: WorkItem) {
    const c = this.c;
    return (
      await c.query<AssetRow>(
        "SELECT a.* FROM image_references r JOIN image_assets a ON a.workspace_id=r.workspace_id AND a.id=r.asset_id WHERE r.task_id=$1 AND a.state='ready'",
        [t.id],
      )
    ).rows.map(asset);
  }
  async outputIntent(t: WorkItem, ordinal: number) {
    const c = this.c;

    const row = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE",
        [t.id],
      )
    ).rows[0];
    if (
      row.state !== "running" ||
      Number(row.storage_remaining) < ASSET_RESERVE
    )
      throw new AppError("TASK_STOPPED", 409);
    const a = (
      await c.query<AssetRow>(
        "INSERT INTO image_assets(workspace_id,user_id,task_id,ordinal,state,reserved_bytes) VALUES($1,$2,$3,$4,'staging',$5) RETURNING *",
        [t.workspaceId, t.userId, t.id, ordinal, ASSET_RESERVE],
      )
    ).rows[0];
    await c.query(
      "UPDATE image_tasks SET storage_remaining=storage_remaining-$2 WHERE id=$1",
      [t.id, ASSET_RESERVE],
    );
    return asset(a);
  }
  async finish(t: WorkItem, errorCode?: string, cancelled = false) {
    const c = this.c;

    const row = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE",
        [t.id],
      )
    ).rows[0];
    if (row) await this.finishRow(c, row, errorCode, cancelled);
  }
}
