import type pg from "pg";
import { createHash } from "node:crypto";
import {
  AppError,
  type CanvasStore,
  type CanvasRepository,
} from "@tuyile/core";
import {
  emptyProjectDraft,
  projectDraftDocument,
  type ProjectDraftSave,
  type ProjectDraftSnapshot,
  emptyCanvas,
  canvasDocument,
  type Principal,
  type CanvasSave,
  type CanvasSnapshot,
  type CanvasOutput,
  type CanvasSources,
  type Project,
} from "@tuyile/contracts";
import { PgTransactions } from "./transactions.js";
import { PgCreationContext } from "./creation/context.js";
function readDraftDocument(value: unknown) {
  const version = (value as { schemaVersion?: unknown })?.schemaVersion;
  if (version !== undefined && version !== 1)
    throw new AppError("DRAFT_VERSION_UNSUPPORTED", 409);
  return projectDraftDocument.parse(value);
}
class PgCanvasRepository extends PgCreationContext implements CanvasRepository {
  async removeProject(p: Principal, id: string) {
    await this.auth(this.c, p, false, false);
    const project = (
      await this.c.query(
        "SELECT * FROM projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!project) throw new AppError("NOT_FOUND", 404);
    if (project.deleted_at) return;
    if (
      (
        await this.c.query(
          "SELECT 1 FROM image_tasks WHERE workspace_id=$1 AND project_id=$2 AND (state IN ('queued','running') OR pending_review) UNION ALL SELECT 1 FROM planning_jobs WHERE workspace_id=$1 AND project_id=$2 AND state IN ('queued','running') LIMIT 1",
          [p.workspaceId, id],
        )
      ).rowCount
    )
      throw new AppError("PROJECT_BUSY", 409);
    await this.c.query("DELETE FROM draft_references WHERE project_id=$1", [
      id,
    ]);
    await this.c.query(
      "DELETE FROM project_creation_drafts WHERE project_id=$1",
      [id],
    );
    await this.c.query("DELETE FROM canvas_references WHERE project_id=$1", [
      id,
    ]);
    await this.c.query("DELETE FROM project_documents WHERE project_id=$1", [
      id,
    ]);
    await this.c.query("DELETE FROM output_placements WHERE project_id=$1", [
      id,
    ]);
    await this.c.query(
      "DELETE FROM agent_references WHERE job_id IN (SELECT id FROM planning_jobs WHERE project_id=$1)",
      [id],
    );
    await this.c.query(
      "UPDATE agent_plans SET document='{}'::jsonb WHERE job_id IN (SELECT id FROM planning_jobs WHERE project_id=$1)",
      [id],
    );
    await this.c.query(
      "UPDATE planning_jobs SET input='{}'::jsonb,messages='[]'::jsonb WHERE project_id=$1",
      [id],
    );
    await this.c.query(
      "UPDATE image_tasks SET input=jsonb_set(jsonb_set(input,'{prompt}',to_jsonb(''::text)),'{referenceIds}','[]'::jsonb) WHERE project_id=$1",
      [id],
    );
    await this.c.query(
      "UPDATE projects SET deleted_at=now(),name='已删除项目' WHERE id=$1",
      [id],
    );
  }
  private async project(p: Principal, id: string) {
    await this.auth(this.c, p, false, false);
    const r = (
      await this.c.query(
        "SELECT * FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    return r;
  }
  async loadDraft(
    p: Principal,
    project: string,
  ): Promise<ProjectDraftSnapshot> {
    await this.project(p, project);
    const row = (
      await this.c.query(
        "SELECT revision,document FROM project_creation_drafts WHERE project_id=$1",
        [project],
      )
    ).rows[0];
    return row
      ? {
          revision: row.revision,
          document: readDraftDocument(row.document),
        }
      : { revision: 0, document: emptyProjectDraft() };
  }
  async saveDraft(
    p: Principal,
    project: string,
    input: ProjectDraftSave,
  ): Promise<ProjectDraftSnapshot> {
    await this.project(p, project);
    // Project lock also serializes creation with deletion and first-save races.
    const locked = (
      await this.c.query(
        "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
        [p.workspaceId, project],
      )
    ).rows[0];
    if (!locked) throw new AppError("NOT_FOUND", 404);
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const old = (
      await this.c.query(
        "SELECT * FROM project_creation_drafts WHERE project_id=$1",
        [project],
      )
    ).rows[0];
    if (old?.request_key === input.requestKey) {
      // Preserve retries accepted before v1 was explicitly written into the JSON.
      const { schemaVersion: _version, ...legacyDocument } = input.document;
      const legacyHash =
        old.document.schemaVersion === undefined
          ? createHash("sha256")
              .update(JSON.stringify({ ...input, document: legacyDocument }))
              .digest("hex")
          : null;
      if (old.request_hash !== hash && old.request_hash !== legacyHash)
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return {
        revision: old.revision,
        document: readDraftDocument(old.document),
      };
    }
    if ((old?.revision ?? 0) !== input.revision)
      throw new AppError("DRAFT_CONFLICT", 409);
    const assets = [...input.document.referenceIds].sort();
    const ready = await this.c.query(
      "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND state='ready' ORDER BY id FOR UPDATE",
      [p.workspaceId, assets],
    );
    if (ready.rowCount !== assets.length)
      throw new AppError("REFERENCE_UNAVAILABLE", 409);
    const revision = input.revision + 1;
    await this.c.query(
      "INSERT INTO project_creation_drafts(workspace_id,project_id,revision,document,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,document=excluded.document,request_key=excluded.request_key,request_hash=excluded.request_hash,updated_at=now()",
      [
        p.workspaceId,
        project,
        revision,
        input.document,
        input.requestKey,
        hash,
      ],
    );
    await this.c.query("DELETE FROM draft_references WHERE project_id=$1", [
      project,
    ]);
    await this.c.query(
      "INSERT INTO draft_references(workspace_id,project_id,asset_id) SELECT $1,$2,unnest($3::uuid[])",
      [p.workspaceId, project, assets],
    );
    return { revision, document: input.document };
  }
  async load(p: Principal, project: string): Promise<CanvasSnapshot> {
    await this.project(p, project);
    const r = (
      await this.c.query(
        "SELECT document,revision FROM project_documents WHERE project_id=$1",
        [project],
      )
    ).rows[0];
    return r
      ? { document: canvasDocument.parse(r.document), revision: r.revision }
      : { document: emptyCanvas(), revision: 0 };
  }
  async save(
    p: Principal,
    project: string,
    input: CanvasSave,
  ): Promise<CanvasSnapshot> {
    await this.project(p, project);
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const old = (
      await this.c.query(
        "SELECT * FROM project_documents WHERE project_id=$1",
        [project],
      )
    ).rows[0];
    if (old?.request_key === input.requestKey) {
      if (old.request_hash !== hash)
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return { document: old.document, revision: old.revision };
    }
    if ((old?.revision ?? 0) !== input.revision)
      throw new AppError("CANVAS_CONFLICT", 409);
    const assets = [
      ...new Set(
        input.document.nodes.flatMap((n) => (n.assetId ? [n.assetId] : [])),
      ),
    ].sort();
    const ready = await this.c.query(
      "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND state='ready' ORDER BY id FOR UPDATE",
      [p.workspaceId, assets],
    );
    if (ready.rowCount !== assets.length)
      throw new AppError("REFERENCE_UNAVAILABLE", 409);
    const placements = [...new Set(input.placements)];
    const outputs = await this.c.query(
      "SELECT o.id FROM image_outputs o JOIN image_tasks t ON t.id=o.task_id WHERE o.workspace_id=$1 AND t.project_id=$2 AND o.id=ANY($3::uuid[])",
      [p.workspaceId, project, placements],
    );
    if (outputs.rowCount !== placements.length)
      throw new AppError("NOT_FOUND", 404);
    const revision = input.revision + 1;
    await this.c.query(
      "INSERT INTO project_documents(workspace_id,project_id,revision,document,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,document=excluded.document,request_key=excluded.request_key,request_hash=excluded.request_hash",
      [
        p.workspaceId,
        project,
        revision,
        input.document,
        input.requestKey,
        hash,
      ],
    );
    await this.c.query("DELETE FROM canvas_references WHERE project_id=$1", [
      project,
    ]);
    await this.c.query(
      "INSERT INTO canvas_references(workspace_id,project_id,asset_id) SELECT $1,$2,unnest($3::uuid[])",
      [p.workspaceId, project, assets],
    );
    await this.c.query(
      "INSERT INTO output_placements(workspace_id,project_id,output_id) SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING",
      [p.workspaceId, project, placements],
    );
    return { document: input.document, revision };
  }
  async copy(
    p: Principal,
    project: string,
    input: CanvasSave,
  ): Promise<Project> {
    const old = await this.project(p, project);
    // The copy's stable id makes a lost response recoverable without duplicate projects.
    const existing = (
      await this.c.query("SELECT * FROM projects WHERE id=$1", [
        input.requestKey,
      ])
    ).rows[0];
    if (
      existing &&
      (existing.workspace_id !== p.workspaceId || existing.deleted_at)
    )
      throw new AppError("NOT_FOUND", 404);
    if (existing) {
      const saved = (
        await this.c.query(
          "SELECT request_hash FROM project_documents WHERE project_id=$1",
          [existing.id],
        )
      ).rows[0];
      const hash = createHash("sha256")
        .update(JSON.stringify({ ...input, revision: 0, placements: [] }))
        .digest("hex");
      if (saved?.request_hash !== hash)
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return {
        workspaceId: p.workspaceId,
        id: existing.id,
        name: existing.name,
        createdAt: existing.created_at.toISOString(),
      };
    }
    const r = (
      await this.c.query(
        "INSERT INTO projects(id,workspace_id,name) VALUES($1,$2,$3) RETURNING *",
        [input.requestKey, p.workspaceId, `${old.name.slice(0, 70)}（副本）`],
      )
    ).rows[0];
    await this.save(p, r.id, { ...input, revision: 0, placements: [] });
    return {
      workspaceId: p.workspaceId,
      id: r.id,
      name: r.name,
      createdAt: r.created_at.toISOString(),
    };
  }
  async pending(p: Principal, project: string): Promise<CanvasOutput[]> {
    await this.project(p, project);
    const rows = (
      await this.c.query(
        `SELECT o.id AS output_id,o.asset_id,o.task_id,a.width,a.height,
      ARRAY(SELECT s.asset_id FROM image_output_sources s WHERE s.output_id=o.id) AS sources
      FROM image_outputs o JOIN image_tasks t ON t.id=o.task_id JOIN image_assets a ON a.id=o.asset_id
      WHERE o.workspace_id=$1 AND t.project_id=$2 AND a.state='ready'
      AND NOT EXISTS(SELECT 1 FROM output_placements r WHERE r.project_id=$2 AND r.output_id=o.id)
      ORDER BY o.created_at,o.id LIMIT 100`,
        [p.workspaceId, project],
      )
    ).rows;
    return rows.map((r) => ({
      outputId: r.output_id,
      assetId: r.asset_id,
      taskId: r.task_id,
      width: r.width,
      height: r.height,
      sourceIds: r.sources,
    }));
  }
  async sources(p: Principal, project: string): Promise<CanvasSources[]> {
    await this.project(p, project);
    return (
      await this.c.query(
        `SELECT o.asset_id, array_agg(s.asset_id) AS sources FROM canvas_references c
      JOIN image_outputs o ON o.asset_id=c.asset_id JOIN image_output_sources s ON s.output_id=o.id
      WHERE c.workspace_id=$1 AND c.project_id=$2 GROUP BY o.asset_id`,
        [p.workspaceId, project],
      )
    ).rows.map((r) => ({ assetId: r.asset_id, sourceIds: r.sources }));
  }
}
export class PgCanvasStore implements CanvasStore {
  private readonly transactions: PgTransactions;
  constructor(pool: pg.Pool) {
    this.transactions = new PgTransactions(pool);
  }
  read<T>(run: (r: CanvasRepository) => Promise<T>) {
    return this.transactions.read((c) => run(new PgCanvasRepository(c, "")));
  }
  write<T>(owner: string, run: (r: CanvasRepository) => Promise<T>) {
    return this.transactions.write(
      (c) => run(new PgCanvasRepository(c, "")),
      [owner],
    );
  }
}
