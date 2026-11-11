import type pg from "pg";
import type {
  ExternalAgentAction,
  ExternalAgentScope,
  Principal,
} from "@tuyile/contracts";

export async function recordExternalAgentActivity(
  client: pg.PoolClient,
  actor: Principal,
  projectId: string,
  event:
    | { action: "grant_issued" | "grant_revoked"; scopes: ExternalAgentScope[] }
    | { action: "canvas_edited" | "canvas_undone"; revision: number }
    | { action: "image_submitted"; taskId: string },
) {
  await client.query(
    `INSERT INTO external_agent_activity(workspace_id,project_id,user_id,action,scopes,revision,task_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      actor.workspaceId,
      projectId,
      actor.id,
      event.action,
      "scopes" in event ? event.scopes : null,
      "revision" in event ? event.revision : null,
      "taskId" in event ? event.taskId : null,
    ],
  );
}

export interface ExternalAgentActivityRow {
  id: string;
  actor: string;
  action: ExternalAgentAction;
  scopes: ExternalAgentScope[] | null;
  revision: number | null;
  taskId: string | null;
  createdAt: Date;
}
