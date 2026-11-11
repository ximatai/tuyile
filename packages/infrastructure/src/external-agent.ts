import { randomBytes } from "node:crypto";
import type pg from "pg";
import type {
  ExternalAgentGrant,
  ExternalAgentScope,
  Principal,
} from "@tuyile/contracts";
import { AppError, type ExternalAgentAccess } from "@tuyile/core";
import {
  recordExternalAgentActivity,
  type ExternalAgentActivityRow,
} from "./external-agent-activity.js";
import { security } from "./security.js";
import { PgTransactions } from "./transactions.js";

type GrantRow = { expires_at: Date; scopes: ExternalAgentScope[] };

function grant(row: GrantRow): ExternalAgentGrant {
  return { expiresAt: row.expires_at.toISOString(), scopes: row.scopes };
}

export class PgExternalAgentTokens {
  private readonly transactions: PgTransactions;

  constructor(private readonly pool: pg.Pool) {
    this.transactions = new PgTransactions(pool);
  }

  async status(principal: Principal, projectId: string) {
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT expires_at,scopes FROM external_agent_tokens
       WHERE project_id=$1 AND user_id=$2 AND workspace_id=$3
         AND execution_version=$4 AND expires_at>now()`,
      [
        projectId,
        principal.id,
        principal.workspaceId,
        principal.executionVersion,
      ],
    );
    return { grant: rows[0] ? grant(rows[0]) : null };
  }

  async issue(
    principal: Principal,
    projectId: string,
    scopes: ExternalAgentScope[],
  ) {
    const token = `tuyile_${randomBytes(32).toString("base64url")}`;
    return this.transactions.write(
      async (client) => {
        const { rows } = await client.query<GrantRow>(
          `INSERT INTO external_agent_tokens(project_id,workspace_id,user_id,token_hash,execution_version,expires_at,scopes)
         SELECT p.id,p.workspace_id,u.id,$5,u.execution_version,now()+interval '168 hours',$6
         FROM projects p JOIN workspaces w ON w.id=p.workspace_id
         JOIN users u ON u.id=w.owner_id
         WHERE p.id=$1 AND u.id=$2 AND p.workspace_id=$3 AND u.execution_version=$4
           AND p.deleted_at IS NULL AND u.enabled AND NOT u.must_change_password
         ON CONFLICT(project_id) DO UPDATE SET token_hash=excluded.token_hash,
           execution_version=excluded.execution_version,expires_at=excluded.expires_at,scopes=excluded.scopes
         RETURNING expires_at,scopes`,
          [
            projectId,
            principal.id,
            principal.workspaceId,
            principal.executionVersion,
            security.digest(token),
            scopes,
          ],
        );
        if (!rows[0]) throw new AppError("NOT_FOUND", 404);
        await recordExternalAgentActivity(client, principal, projectId, {
          action: "grant_issued",
          scopes,
        });
        return { token, grant: grant(rows[0]) };
      },
      [principal.id],
    );
  }

  async revoke(principal: Principal, projectId: string) {
    await this.transactions.write(
      async (client) => {
        const { rows } = await client.query<{ scopes: ExternalAgentScope[] }>(
          `DELETE FROM external_agent_tokens
         WHERE project_id=$1 AND user_id=$2 AND workspace_id=$3 AND execution_version=$4
           AND EXISTS (SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$3 AND deleted_at IS NULL)
         RETURNING scopes`,
          [
            projectId,
            principal.id,
            principal.workspaceId,
            principal.executionVersion,
          ],
        );
        if (rows[0])
          await recordExternalAgentActivity(client, principal, projectId, {
            action: "grant_revoked",
            scopes: rows[0].scopes,
          });
      },
      [principal.id],
    );
  }

  async activity(principal: Principal, projectId: string, offset: number) {
    const { rows } = await this.pool.query<ExternalAgentActivityRow>(
      `SELECT a.id,u.username AS actor,a.action,a.scopes,a.revision,a.task_id AS "taskId",a.created_at AS "createdAt"
       FROM external_agent_activity a JOIN users u ON u.id=a.user_id
       WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.user_id=$3
       ORDER BY a.id DESC LIMIT 21 OFFSET $4`,
      [principal.workspaceId, projectId, principal.id, offset],
    );
    return {
      items: rows
        .slice(0, 20)
        .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      hasMore: rows.length > 20,
    };
  }

  async authenticate(authorization: string | undefined) {
    const token = /^Bearer (tuyile_[\w-]{43})$/i.exec(authorization ?? "")?.[1];
    if (!token) return null;
    const tokenHash = security.digest(token);
    const { rows } = await this.pool.query<{
      principal: Principal;
      projectId: string;
      scopes: ExternalAgentScope[];
    }>(
      `SELECT t.project_id AS "projectId",t.scopes,
         json_build_object('id',u.id,'username',u.username,'role',u.role,
           'enabled',u.enabled,'activated',true,'workspaceId',t.workspace_id,
           'executionVersion',u.execution_version) AS principal
       FROM external_agent_tokens t
       JOIN projects p ON (p.workspace_id,p.id)=(t.workspace_id,t.project_id)
       JOIN users u ON u.id=t.user_id
       WHERE t.token_hash=$1 AND t.expires_at>now() AND p.deleted_at IS NULL
         AND u.enabled AND u.password_hash IS NOT NULL AND NOT u.must_change_password
         AND t.execution_version=u.execution_version`,
      [tokenHash],
    );
    return rows[0] ? { ...rows[0], tokenHash } : null;
  }
}

/** Write transactions hold the owner lock, as do token changes and account revocation. */
export async function requireExternalAgentScope(
  client: pg.PoolClient,
  access: ExternalAgentAccess,
  scope: ExternalAgentScope,
) {
  const { rows } = await client.query(
    `SELECT 1 FROM external_agent_tokens t JOIN users u ON u.id=t.user_id
     WHERE t.project_id=$1 AND t.user_id=$2 AND t.token_hash=$3 AND $4=ANY(t.scopes)
       AND t.expires_at>now() AND t.execution_version=u.execution_version
       AND u.enabled AND NOT u.must_change_password`,
    [access.projectId, access.principal.id, access.tokenHash, scope],
  );
  if (!rows.length)
    throw new AppError("EXTERNAL_AGENT_PERMISSION_REQUIRED", 403);
}

export async function requireProjectAssets(
  client: pg.PoolClient,
  workspaceId: string,
  projectId: string,
  ids: readonly string[],
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { rows } = await client.query<{ output_id: string | null }>(
    `SELECT o.id AS output_id FROM image_assets a
     LEFT JOIN (image_outputs o JOIN image_tasks t ON t.id=o.task_id AND t.project_id=$2)
       ON o.workspace_id=a.workspace_id AND o.asset_id=a.id
     WHERE a.workspace_id=$1 AND a.id=ANY($3::uuid[]) AND a.state='ready'
       AND (o.id IS NOT NULL OR EXISTS (SELECT 1 FROM canvas_references c
           WHERE c.workspace_id=$1 AND c.project_id=$2 AND c.asset_id=a.id))`,
    [workspaceId, projectId, unique],
  );
  if (rows.length !== unique.length)
    throw new AppError("REFERENCE_UNAVAILABLE", 404);
  return rows.flatMap(({ output_id }) => (output_id ? [output_id] : []));
}
