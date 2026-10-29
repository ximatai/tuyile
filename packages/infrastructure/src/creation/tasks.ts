import type { TaskRow, OutputRow } from "./rows.js";
import type { AdmissionSnapshot } from "@tuyile/core";

import { createHash } from "node:crypto";
import { AppError, ASSET_RESERVE } from "@tuyile/core";
import type { Principal, ImageInput } from "@tuyile/contracts";
import { PgCreationContext } from "./context.js";
export class PgTasksRepository extends PgCreationContext {
  async existingAdmission(p: Principal, input: ImageInput) {
    const c = this.c;

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
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE workspace_id=$1 AND project_id=$2 AND request_key=$3",
        [p.workspaceId, input.projectId, input.requestKey],
      )
    ).rows[0];
    if (old) {
      if (old.input_hash !== hash)
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return this.dto(c, old);
    }
    return null;
  }
  async insert(
    p: Principal,
    input: ImageInput,
    snapshot: AdmissionSnapshot,
    providerId: string,
  ) {
    const c = this.c;
    const task = (
      await c.query<TaskRow>(
        "INSERT INTO image_tasks(workspace_id,project_id,user_id,execution_version,request_key,input_hash,input,policy,provider_id,day,held,storage_remaining,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
        [
          p.workspaceId,
          input.projectId,
          p.id,
          p.executionVersion,
          input.requestKey,
          createHash("sha256").update(JSON.stringify(input)).digest("hex"),
          JSON.stringify(input),
          JSON.stringify(snapshot.budget.policy),
          providerId,
          snapshot.day,
          input.count,
          ASSET_RESERVE * input.count,
          new Date(this.now().getTime() + 30 * 60000),
        ],
      )
    ).rows[0];
    return this.dto(c, task);
  }
  async tasks(p: Principal, projectId?: string, offset = 0) {
    const c = this.c;

    await this.auth(c, p, false, false);
    const rows = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE workspace_id=$1 AND ($2::uuid IS NULL OR project_id=$2) ORDER BY created_at DESC,id LIMIT 51 OFFSET $3",
        [p.workspaceId, projectId ?? null, offset],
      )
    ).rows;
    const outputs = (
      await c.query<OutputRow>(
        "SELECT a.*,o.id AS output_id FROM image_outputs o JOIN image_assets a ON a.workspace_id=o.workspace_id AND a.id=o.asset_id WHERE o.workspace_id=$1 AND o.task_id=ANY($2::uuid[]) ORDER BY o.task_id,o.ordinal",
        [p.workspaceId, rows.map((r) => r.id)],
      )
    ).rows;
    const byTask = new Map<string, OutputRow[]>();
    for (const output of outputs) {
      const group = byTask.get(output.task_id) ?? [];
      group.push(output);
      byTask.set(output.task_id, group);
    }
    return Promise.all(rows.map((r) => this.dto(c, r, byTask.get(r.id) ?? [])));
  }
  async task(p: Principal, id: string) {
    const c = this.c;

    await this.auth(c, p, false, false);
    const r = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE workspace_id=$1 AND id=$2",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    return this.dto(c, r);
  }
  async recover(p: Principal, projectId: string, key: string) {
    const c = this.c;

    await this.auth(c, p, false, false);
    const r = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE workspace_id=$1 AND project_id=$2 AND request_key=$3",
        [p.workspaceId, projectId, key],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    return this.dto(c, r);
  }
  async cancel(p: Principal, id: string) {
    const c = this.c;

    await this.auth(c, p);
    const t = (
      await c.query<TaskRow>(
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
  }
}
