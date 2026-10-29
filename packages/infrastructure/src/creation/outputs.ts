import type { TaskRow } from "./rows.js";
import {
  AppError,
  type PreparedAsset,
  type OutputSettlement,
} from "@tuyile/core";
import { PgCreationContext } from "./context.js";
export class PgOutputsRepository extends PgCreationContext {
  async record(a: PreparedAsset, attemptId: string): Promise<OutputSettlement> {
    const c = this.c;
    const t = (
      await c.query<TaskRow>(
        "SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE",
        [a.taskId],
      )
    ).rows[0];
    if (!t || t.state !== "running" || t.resolved_at)
      throw new AppError("TASK_STOPPED", 409);
    const attempt = (
      await c.query(
        "SELECT * FROM image_attempts WHERE id=$1 AND task_id=$2 AND ordinal=$3",
        [attemptId, a.taskId, a.ordinal],
      )
    ).rows[0];
    if (attempt?.state !== "received")
      throw new AppError("ATTEMPT_STOPPED", 409);
    await c.query("UPDATE image_attempts SET state='succeeded' WHERE id=$1", [
      attemptId,
    ]);
    const output = (
      await c.query(
        "INSERT INTO image_outputs(workspace_id,task_id,ordinal,asset_id) VALUES($1,$2,$3,$4) RETURNING id",
        [a.workspaceId, t.id, a.ordinal, a.id],
      )
    ).rows[0];
    await c.query(
      "UPDATE image_tasks SET used=used+1,held=held-1 WHERE id=$1",
      [t.id],
    );
    await c.query(
      "INSERT INTO image_output_sources(workspace_id,output_id,asset_id) SELECT $1,$2,asset_id FROM image_references WHERE task_id=$3 ON CONFLICT DO NOTHING",
      [a.workspaceId, output.id, t.id],
    );
    return {
      outputId: output.id,
      taskId: t.id,
      workspaceId: t.workspace_id,
      userId: t.user_id,
      day: t.day,
    };
  }
}
