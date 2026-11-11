import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

type GrantRow = {
  token_hash: string;
  expires_at: Date;
  verified_at: Date | null;
  scopes: ExternalAgentScope[];
};

const imageDownloadLifetime = 5 * 60;

function imageDownloadSignature(
  key: Buffer,
  tokenHash: string,
  projectId: string,
  assetId: string,
  expires: number,
) {
  return createHmac("sha256", key)
    .update(`${tokenHash}:${projectId}:${assetId}:${expires}`)
    .digest();
}

function grant(row: GrantRow): ExternalAgentGrant {
  return {
    // Derive a public identifier without exposing the bearer credential or its stored digest.
    id: security.digest(`external-agent-grant:${row.token_hash}`),
    expiresAt: row.expires_at.toISOString(),
    verifiedAt: row.verified_at?.toISOString() ?? null,
    scopes: row.scopes,
  };
}

export class PgExternalAgentTokens {
  private readonly transactions: PgTransactions;
  private readonly imageDownloadKey: Buffer;

  constructor(
    private readonly pool: pg.Pool,
    masterKey: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(masterKey))
      throw new Error("INVALID_MASTER_KEY");
    this.transactions = new PgTransactions(pool);
    this.imageDownloadKey = createHmac("sha256", Buffer.from(masterKey, "hex"))
      .update("tuyile:mcp:image-download:v1")
      .digest();
  }

  async status(principal: Principal, projectId: string) {
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT token_hash,expires_at,scopes,verified_at FROM external_agent_tokens
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

  async accountStatus(
    principal: Principal,
    database: pg.Pool | pg.PoolClient = this.pool,
  ) {
    const { rows } = await database.query<
      Omit<GrantRow, "token_hash"> & {
        token_hash: string | null;
        active: boolean;
      }
    >(
      `SELECT token_hash,expires_at,scopes,verified_at,
              execution_version=$3 AND expires_at>clock_timestamp() AS active
       FROM external_agent_tokens WHERE project_id IS NULL AND user_id=$1 AND workspace_id=$2`,
      [principal.id, principal.workspaceId, principal.executionVersion],
    );
    const row = rows[0];
    return {
      grant:
        row?.active && row.token_hash
          ? grant({ ...row, token_hash: row.token_hash })
          : null,
      savedScopes: row?.scopes ?? [],
    };
  }

  private async requireCurrentAccountGrant(
    client: pg.PoolClient,
    principal: Principal,
    expectedGrantId: string | null,
  ) {
    const { grant } = await this.accountStatus(principal, client);
    if ((grant?.id ?? null) !== expectedGrantId)
      throw new AppError("EXTERNAL_AGENT_GRANT_CHANGED", 409);
  }

  async issueAccount(
    principal: Principal,
    scopes: ExternalAgentScope[],
    expectedGrantId: string | null,
  ) {
    const token = `tuyile_${randomBytes(32).toString("base64url")}`;
    return this.transactions.write(
      async (client) => {
        await this.requireCurrentAccountGrant(
          client,
          principal,
          expectedGrantId,
        );
        const { rows } = await client.query<GrantRow>(
          `INSERT INTO external_agent_tokens(workspace_id,user_id,token_hash,execution_version,expires_at,scopes)
           SELECT w.id,u.id,$4,u.execution_version,now()+interval '168 hours',$5
           FROM users u JOIN workspaces w ON w.owner_id=u.id
           WHERE u.id=$1 AND w.id=$2 AND u.execution_version=$3
             AND u.enabled AND u.password_hash IS NOT NULL AND NOT u.must_change_password
           ON CONFLICT(user_id) WHERE project_id IS NULL DO UPDATE SET token_hash=excluded.token_hash,
             workspace_id=excluded.workspace_id,execution_version=excluded.execution_version,
             expires_at=excluded.expires_at,scopes=excluded.scopes,verified_at=NULL
           RETURNING token_hash,expires_at,scopes,verified_at`,
          [
            principal.id,
            principal.workspaceId,
            principal.executionVersion,
            security.digest(token),
            scopes,
          ],
        );
        if (!rows[0]) throw new AppError("NOT_FOUND", 404);
        return { token, grant: grant(rows[0]), savedScopes: scopes };
      },
      [principal.id],
    );
  }

  async revokeAccount(principal: Principal, expectedGrantId: string | null) {
    return this.transactions.write(
      async (client) => {
        await this.requireCurrentAccountGrant(
          client,
          principal,
          expectedGrantId,
        );
        const { rows } = await client.query<{ scopes: ExternalAgentScope[] }>(
          `UPDATE external_agent_tokens t SET token_hash=NULL,verified_at=NULL
           FROM users u WHERE t.project_id IS NULL AND t.user_id=$1 AND t.workspace_id=$2
             AND u.id=t.user_id AND u.execution_version=$3 AND t.execution_version=$3
           RETURNING t.scopes`,
          [principal.id, principal.workspaceId, principal.executionVersion],
        );
        return { grant: null, savedScopes: rows[0]?.scopes ?? [] };
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
    return this.transactions.read(async (client) => {
      const { rows } = await client.query<ExternalAgentActivityRow>(
        `SELECT a.id,u.username AS actor,a.action,a.scopes,a.revision,a.task_id AS "taskId",a.created_at AS "createdAt"
       FROM external_agent_activity a JOIN users u ON u.id=a.user_id
       WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.user_id=$3
       ORDER BY a.id DESC LIMIT 21 OFFSET $4`,
        [principal.workspaceId, projectId, principal.id, offset],
      );
      const undo = await client.query<{ revision: number }>(
        `SELECT u.revision FROM external_agent_canvas_undo u
       JOIN project_documents d ON d.project_id=u.project_id AND d.revision=u.revision
       WHERE u.workspace_id=$1 AND u.project_id=$2`,
        [principal.workspaceId, projectId],
      );
      return {
        items: rows
          .slice(0, 20)
          .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        hasMore: rows.length > 20,
        undoRevision: undo.rows[0]?.revision ?? null,
      };
    });
  }

  async verifyConnection(tokenHash: string) {
    await this.pool.query(
      "UPDATE external_agent_tokens SET verified_at=now() WHERE token_hash=$1 AND verified_at IS NULL AND expires_at>now()",
      [tokenHash],
    );
  }

  requireImage(access: ExternalAgentAccess, assetId: string) {
    return this.authorizeImage(access, assetId, "canvas:read");
  }

  private authorizeImage(
    access: ExternalAgentAccess,
    assetId: string,
    scope: "canvas:read" | "images:download",
  ) {
    return this.transactions.read(async (client) => {
      const grantExpires = await requireExternalAgentScope(
        client,
        access,
        scope,
      );
      await requireProjectAssets(
        client,
        access.principal.workspaceId,
        access.projectId,
        [assetId],
      );
      return grantExpires;
    });
  }

  async issueImageDownload(access: ExternalAgentAccess, assetId: string) {
    const grantExpires = await this.authorizeImage(
      access,
      assetId,
      "images:download",
    );
    const expires = Math.min(
      Math.floor(Date.now() / 1000) + imageDownloadLifetime,
      Math.floor(grantExpires.getTime() / 1000),
    );
    return {
      expires,
      signature: imageDownloadSignature(
        this.imageDownloadKey,
        access.tokenHash,
        access.projectId,
        assetId,
        expires,
      ).toString("hex"),
    };
  }

  async verifyImageDownload(
    projectId: string,
    assetId: string,
    expires: number,
    signature: string,
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (expires <= now || expires > now + imageDownloadLifetime)
      throw new AppError("NOT_FOUND", 404);
    const received = Buffer.from(signature, "hex");
    return this.transactions.read(async (client) => {
      const { rows } = await client.query<{
        token_hash: string;
        principal: Principal;
      }>(
        `SELECT t.token_hash,
           json_build_object('id',u.id,'username',u.username,'role',u.role,
             'enabled',u.enabled,'activated',true,'workspaceId',t.workspace_id,
             'executionVersion',u.execution_version) AS principal
         FROM projects p JOIN external_agent_tokens t ON t.workspace_id=p.workspace_id
         JOIN users u ON u.id=t.user_id
         WHERE p.id=$1 AND p.deleted_at IS NULL AND t.project_id IS NULL
           AND t.token_hash IS NOT NULL AND 'images:download'=ANY(t.scopes)
           AND t.expires_at>clock_timestamp() AND t.execution_version=u.execution_version
           AND u.enabled AND u.password_hash IS NOT NULL AND NOT u.must_change_password`,
        [projectId],
      );
      const grant = rows.find((row) => {
        const expected = imageDownloadSignature(
          this.imageDownloadKey,
          row.token_hash,
          projectId,
          assetId,
          expires,
        );
        return (
          received.length === expected.length &&
          timingSafeEqual(received, expected)
        );
      });
      if (!grant || expires <= Math.floor(Date.now() / 1000))
        throw new AppError("NOT_FOUND", 404);
      await requireProjectAssets(
        client,
        grant.principal.workspaceId,
        projectId,
        [assetId],
      );
      return grant.principal;
    });
  }

  async recentImages(access: ExternalAgentAccess, limit: number) {
    return this.transactions.read(async (client) => {
      await requireExternalAgentScope(client, access, "canvas:read");
      const { rows } = await client.query<{
        assetId: string;
        taskId: string;
        width: number;
        height: number;
        mime: string;
        createdAt: Date;
      }>(
        `SELECT a.id AS "assetId", t.id AS "taskId", a.width, a.height, a.mime,
                o.created_at AS "createdAt"
         FROM image_tasks t
         JOIN image_outputs o ON o.workspace_id=t.workspace_id AND o.task_id=t.id
         JOIN image_assets a ON a.workspace_id=o.workspace_id AND a.id=o.asset_id
         WHERE t.workspace_id=$1 AND t.project_id=$2 AND a.state='ready'
         ORDER BY o.created_at DESC, o.id DESC LIMIT $3`,
        [access.principal.workspaceId, access.projectId, limit],
      );
      return rows.map(({ createdAt, ...image }) => ({
        ...image,
        createdAt: createdAt.toISOString(),
      }));
    });
  }

  async authenticate(authorization: string | undefined) {
    const token = /^Bearer (tuyile_[\w-]{43})$/i.exec(authorization ?? "")?.[1];
    if (!token) return null;
    const tokenHash = security.digest(token);
    const { rows } = await this.pool.query<{
      principal: Principal;
      legacyProjectId: string | null;
      verified: boolean;
      scopes: ExternalAgentScope[];
    }>(
      `SELECT t.project_id AS "legacyProjectId",t.scopes,t.verified_at IS NOT NULL AS verified,
         json_build_object('id',u.id,'username',u.username,'role',u.role,
           'enabled',u.enabled,'activated',true,'workspaceId',t.workspace_id,
           'executionVersion',u.execution_version) AS principal
       FROM external_agent_tokens t
       LEFT JOIN projects p ON (p.workspace_id,p.id)=(t.workspace_id,t.project_id) AND p.deleted_at IS NULL
       JOIN users u ON u.id=t.user_id
       WHERE t.token_hash=$1 AND t.expires_at>now() AND (t.project_id IS NULL OR p.id IS NOT NULL)
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
  const { rows } = await client.query<{ expires_at: Date }>(
    `SELECT t.expires_at FROM external_agent_tokens t JOIN users u ON u.id=t.user_id
     WHERE (t.project_id IS NULL OR t.project_id=$1) AND t.user_id=$2
       AND t.token_hash=$3 AND $4=ANY(t.scopes) AND t.workspace_id=$5
       AND t.expires_at>clock_timestamp() AND t.execution_version=u.execution_version
       AND u.enabled AND NOT u.must_change_password`,
    [
      access.projectId,
      access.principal.id,
      access.tokenHash,
      scope,
      access.principal.workspaceId,
    ],
  );
  if (!rows.length)
    throw new AppError("EXTERNAL_AGENT_PERMISSION_REQUIRED", 403);
  return rows[0].expires_at;
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
