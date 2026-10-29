import type { TaskRow, AssetRow, OutputRow, PolicyRow } from "./rows.js";
import pg from "pg";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  AppError,
  completedTaskState,
  shanghaiDay,
  type StoredAsset,
} from "@tuyile/core";
import type { Principal, ImagePolicy, ImageTask } from "@tuyile/contracts";
export const asset = (r: AssetRow): StoredAsset => ({
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
export function policy(r: PolicyRow): ImagePolicy {
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
export class PgCreationContext {
  constructor(
    protected readonly c: pg.PoolClient,
    protected readonly masterKey: string,
    protected readonly fakeAllowed = false,
    protected readonly now = () => new Date(),
  ) {}
  protected async auth(
    c: pg.PoolClient,
    p: Principal,
    admin = false,
    lock = true,
  ) {
    const r = (
      await c.query(
        `SELECT * FROM users WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [p.id],
      )
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
  protected async ensure(
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
  protected encrypt(key: string) {
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
  protected decrypt(value: string) {
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
  protected async dto(
    c: pg.PoolClient,
    r: TaskRow,
    loadedOutputs?: OutputRow[],
  ): Promise<ImageTask> {
    const outputs =
      loadedOutputs ??
      (
        await c.query<OutputRow>(
          "SELECT a.*,o.id AS output_id FROM image_outputs o JOIN image_assets a ON a.workspace_id=o.workspace_id AND a.id=o.asset_id WHERE o.task_id=$1 ORDER BY o.ordinal",
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
      outputs: outputs.map((a: OutputRow) => {
        if (!a.mime || !a.width || !a.height)
          throw new AppError("OUTPUT_METADATA_INVALID", 500);
        return {
          id: a.id,
          outputId: a.output_id,
          deleted: a.state !== "ready",
          mime: a.mime,
          width: a.width,
          height: a.height,
          bytes: Number(a.bytes),
          createdAt: a.created_at.toISOString(),
        };
      }),
    };
  }
  protected async release(c: pg.PoolClient, t: TaskRow, keep: number) {
    const released = t.held - keep;
    await c.query(
      "UPDATE image_quota_reservations SET released=released+$2,held=held-$2 WHERE task_id=$1",
      [t.id, released],
    );
    if (released > 0)
      await c.query(
        "INSERT INTO image_quota_entries(workspace_id,task_id,user_id,day,source,kind,used_delta,held_delta,reservation_id) VALUES($1,$2,$3,$4,'finish','release',0,$5,(SELECT id FROM image_quota_reservations WHERE task_id=$2))",
        [t.workspace_id, t.id, t.user_id, t.day, -released],
      );
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
  protected async finishRow(
    c: pg.PoolClient,
    t: TaskRow,
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
    const state = completedTaskState({
      count: t.input.count,
      used: t.used,
      unknownHeld: keep,
      cancelled,
    });
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
}
