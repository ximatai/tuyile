import { randomBytes } from "node:crypto";
import type pg from "pg";
import type {
  ExternalAgentGrant,
  ExternalAgentScope,
  Principal,
} from "@tuyile/contracts";
import { AppError } from "@tuyile/core";
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
        return { token, grant: grant(rows[0]) };
      },
      [principal.id],
    );
  }

  async revoke(principal: Principal, projectId: string) {
    await this.pool.query(
      `DELETE FROM external_agent_tokens
       WHERE project_id=$1 AND user_id=$2 AND workspace_id=$3 AND execution_version=$4`,
      [
        projectId,
        principal.id,
        principal.workspaceId,
        principal.executionVersion,
      ],
    );
  }

  async authenticate(authorization: string | undefined) {
    const token = /^Bearer (tuyile_[\w-]{43})$/i.exec(authorization ?? "")?.[1];
    if (!token) return null;
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
      [security.digest(token)],
    );
    return rows[0] ?? null;
  }
}
