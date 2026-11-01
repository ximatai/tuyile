import type pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import {
  AppError,
  type DemoStore,
  type DemoInitialization,
  type DemoWork,
  type DemoManifest,
  type DemoPlan,
  type StoredAsset,
} from "@tuyile/core";
import {
  canvasDocument,
  projectDraftDocument,
  emptyProjectDraft,
  type Principal,
  type DemoStatus,
  type DemoTemplateInfo,
  type ProjectDemo,
  type PublishDemoInput,
  type DemoImage,
} from "@tuyile/contracts";
import { PgCreationContext, asset } from "./creation/context.js";
import type { AssetRow } from "./creation/rows.js";
import { PgTransactions } from "./transactions.js";
const info = (r: any): DemoTemplateInfo => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at.toISOString(),
});
class DemoRepository extends PgCreationContext {
  constructor(c: pg.PoolClient) {
    super(c, "");
  }
  async authorize(p: Principal, targetId = p.id, admin = false) {
    await this.auth(this.c, p, admin || p.id !== targetId, false);
    const actor = (
      await this.c.query("SELECT must_change_password FROM users WHERE id=$1", [
        p.id,
      ])
    ).rows[0];
    if (actor.must_change_password)
      throw new AppError("PASSWORD_CHANGE_REQUIRED", 403);
    const target = (
      await this.c.query(
        "SELECT u.id,u.enabled,w.id AS workspace_id FROM users u JOIN workspaces w ON w.owner_id=u.id WHERE u.id=$1",
        [targetId],
      )
    ).rows[0];
    if (!target) throw new AppError("NOT_FOUND", 404);
    if (!target.enabled) throw new AppError("ACCOUNT_DISABLED", 409);
    return target;
  }
  async status(p: Principal, targetId: string): Promise<DemoStatus> {
    await this.authorize(p, targetId);
    const r = (
      await this.c.query(
        "SELECT d.state,d.project_id,p.deleted_at FROM demo_provisioning d LEFT JOIN projects p ON p.id=d.project_id WHERE d.user_id=$1",
        [targetId],
      )
    ).rows[0];
    if (!r) return { state: "none" };
    if (r.state === "ready")
      return r.deleted_at
        ? { state: "removed" }
        : { state: "ready", projectId: r.project_id };
    return { state: r.state };
  }
  async template(p: Principal) {
    await this.authorize(p, p.id, true);
    const r = (
      await this.c.query(
        "SELECT id,name,created_at FROM demo_templates WHERE active",
      )
    ).rows[0];
    return r ? info(r) : null;
  }
  async publish(p: Principal, input: PublishDemoInput) {
    await this.authorize(p, p.id, true);
    // Serialize active-version replacement, independently of account/content locks.
    await this.c.query("SELECT pg_advisory_xact_lock(72110407)");
    const old = (
      await this.c.query("SELECT * FROM demo_templates WHERE id=$1", [
        input.requestKey,
      ])
    ).rows[0];
    if (old) {
      if (
        old.created_by !== p.id ||
        old.source_project_id !== input.projectId ||
        old.request_hash !==
          createHash("sha256").update(JSON.stringify(input)).digest("hex")
      )
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return info(old);
    }
    const project = (
      await this.c.query(
        "SELECT * FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
        [p.workspaceId, input.projectId],
      )
    ).rows[0];
    if (!project) throw new AppError("NOT_FOUND", 404);
    const snapshot = (
      await this.c.query(
        "SELECT document FROM project_documents WHERE workspace_id=$1 AND project_id=$2",
        [p.workspaceId, project.id],
      )
    ).rows[0];
    const document = canvasDocument.parse(snapshot?.document);
    if (
      document.nodes.length !== 3 ||
      document.nodes.some((n) => n.kind !== "image" || n.parentId) ||
      new Set(document.nodes.map((n) => n.assetId)).size !== 3
    )
      throw new AppError("DEMO_SOURCE_INVALID", 409);
    const images: DemoManifest["images"] = [];
    for (const node of [...document.nodes].sort((a, b) =>
      a.assetId!.localeCompare(b.assetId!),
    )) {
      const r = (
        await this.c.query<AssetRow>(
          "SELECT * FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state='ready' FOR UPDATE",
          [p.workspaceId, node.assetId],
        )
      ).rows[0];
      if (!r?.task_id) throw new AppError("DEMO_SOURCE_INVALID", 409);
      const task = (
        await this.c.query(
          "SELECT state,pending_review,input FROM image_tasks WHERE workspace_id=$1 AND id=$2",
          [p.workspaceId, r.task_id],
        )
      ).rows[0];
      if (
        task?.state !== "succeeded" ||
        task.pending_review ||
        !task.input?.prompt
      )
        throw new AppError("DEMO_SOURCE_INVALID", 409);
      const sources = (
        await this.c.query(
          "SELECT s.asset_id FROM image_output_sources s JOIN image_outputs o ON o.id=s.output_id AND o.workspace_id=s.workspace_id WHERE o.workspace_id=$1 AND o.asset_id=$2 ORDER BY s.asset_id",
          [p.workspaceId, r.id],
        )
      ).rows.map((s) => s.asset_id);
      if (sources.some((id) => !document.nodes.some((n) => n.assetId === id)))
        throw new AppError("DEMO_SOURCE_INVALID", 409);
      const i = task.input;
      images.push({
        assetId: r.id,
        label: node.label,
        prompt: i.prompt,
        model: i.model,
        settings: {
          width: i.width,
          height: i.height,
          quality: i.quality,
          format: i.format,
        },
        sourceIds: sources,
        source: asset(r),
        previewBytes: Number(r.preview_bytes),
      });
    }
    // Require an actual A+B -> C lineage, not three unrelated successes.
    if (
      images.filter((i) => i.sourceIds.length === 0).length !== 2 ||
      images.filter((i) => i.sourceIds.length === 2).length !== 1
    )
      throw new AppError("DEMO_SOURCE_INVALID", 409);
    const sourceDraft = (
      await this.c.query(
        "SELECT document FROM project_creation_drafts WHERE workspace_id=$1 AND project_id=$2",
        [p.workspaceId, project.id],
      )
    ).rows[0];
    const draft = sourceDraft
      ? projectDraftDocument.parse(sourceDraft.document)
      : emptyProjectDraft();
    draft.mode = "direct";
    draft.direct.settings.modelKey = "";
    draft.agent.settings.modelKey = "";
    draft.agent.conversationModel = "";
    draft.agent.skillId = "";
    if (input.starterPrompt) draft.direct.prompt = input.starterPrompt;
    if (input.agentPrompt) draft.agent.prompt = input.agentPrompt;
    const result = images.find((i) => i.sourceIds.length === 2)!;
    draft.referenceIds = result.sourceIds;
    const manifest: DemoManifest = {
      name: project.name,
      document: { ...document, viewport: { x: 20, y: 85, zoom: 0.98 } },
      draft,
      images,
    };
    await this.c.query("UPDATE demo_templates SET active=false WHERE active");
    const created = (
      await this.c.query(
        "INSERT INTO demo_templates(id,created_by,source_project_id,name,manifest,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          input.requestKey,
          p.id,
          project.id,
          project.name,
          manifest,
          createHash("sha256").update(JSON.stringify(input)).digest("hex"),
        ],
      )
    ).rows[0];
    for (const image of images)
      await this.c.query(
        "INSERT INTO demo_template_assets(template_id,workspace_id,asset_id) VALUES($1,$2,$3)",
        [created.id, p.workspaceId, image.assetId],
      );
    return info(created);
  }
  async project(p: Principal, id: string): Promise<ProjectDemo | null> {
    await this.authorize(p);
    const owned = (
      await this.c.query(
        "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [p.workspaceId, id],
      )
    ).rowCount;
    if (!owned) throw new AppError("NOT_FOUND", 404);
    const r = (
      await this.c.query(
        "SELECT d.template_id,d.images,t.name FROM demo_projects d JOIN demo_templates t ON t.id=d.template_id WHERE d.workspace_id=$1 AND d.project_id=$2",
        [p.workspaceId, id],
      )
    ).rows[0];
    return r
      ? { templateId: r.template_id, name: r.name, images: r.images }
      : null;
  }
  async prepare(
    p: Principal,
    targetId: string,
  ): Promise<DemoWork | DemoStatus> {
    const target = await this.authorize(p, targetId);
    const job = (
      await this.c.query(
        "SELECT * FROM demo_provisioning WHERE user_id=$1 FOR UPDATE",
        [targetId],
      )
    ).rows[0];
    if (!job || job.state === "ready") return this.status(p, targetId);
    const template = (
      await this.c.query("SELECT manifest FROM demo_templates WHERE id=$1", [
        job.template_id,
      ])
    ).rows[0];
    if (!template) throw new AppError("DEMO_TEMPLATE_UNAVAILABLE", 409);
    const manifest = template.manifest as DemoManifest;
    let plan = job.plan as DemoPlan | null;
    if (!plan) {
      const bytes = manifest.images.reduce(
        (n, i) => n + i.source.bytes + i.previewBytes,
        0,
      );
      const limits = await this.ensure(this.c, targetId);
      if (
        Number(limits.storage_used) + Number(limits.storage_reserved) + bytes >
        Number(limits.storage_limit)
      )
        throw new AppError("STORAGE_QUOTA", 409);
      plan = {
        projectId: randomUUID(),
        assets: manifest.images.map((i) => ({
          sourceId: i.assetId,
          target: {
            ...i.source,
            id: randomUUID(),
            fileKey: randomUUID(),
            workspaceId: target.workspace_id,
            userId: targetId,
            taskId: null,
            state: "staging",
          },
        })),
      };
      await this.c.query(
        "UPDATE image_policies SET storage_reserved=storage_reserved+$2 WHERE user_id=$1",
        [targetId, bytes],
      );
      await this.c.query(
        "UPDATE demo_provisioning SET plan=$2,state='pending' WHERE user_id=$1",
        [targetId, plan],
      );
    }
    return { manifest, plan };
  }
  async complete(
    p: Principal,
    targetId: string,
    work: DemoWork,
  ): Promise<DemoStatus> {
    const target = await this.authorize(p, targetId);
    const job = (
      await this.c.query(
        "SELECT * FROM demo_provisioning WHERE user_id=$1 FOR UPDATE",
        [targetId],
      )
    ).rows[0];
    if (job?.state === "ready") return this.status(p, targetId);
    if (!job?.plan || job.plan.projectId !== work.plan.projectId)
      throw new AppError("DEMO_INITIALIZATION_CONFLICT", 409);
    const { plan, manifest } = work;
    const ids = new Map(plan.assets.map((a) => [a.sourceId, a.target.id]));
    const images: DemoImage[] = manifest.images
      .map((i) => ({
        assetId: ids.get(i.assetId)!,
        label: i.label,
        prompt: i.prompt,
        model: i.model,
        settings: i.settings,
        sourceIds: i.sourceIds.map((id) => ids.get(id)!),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const bytes = manifest.images.reduce(
      (n, i) => n + i.source.bytes + i.previewBytes,
      0,
    );
    const limits = await this.ensure(this.c, targetId);
    if (
      Number(limits.storage_used) + Number(limits.storage_reserved) >
      Number(limits.storage_limit)
    )
      throw new AppError("STORAGE_QUOTA", 409);
    await this.c.query(
      "INSERT INTO projects(id,workspace_id,name) VALUES($1,$2,$3)",
      [plan.projectId, target.workspace_id, manifest.name],
    );
    for (const item of plan.assets) {
      const image = manifest.images.find((i) => i.assetId === item.sourceId)!;
      const a = item.target;
      await this.c.query(
        "INSERT INTO image_assets(id,workspace_id,user_id,state,mime,width,height,bytes,preview_bytes,hash,file_key,demo_template_id) VALUES($1,$2,$3,'ready',$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          a.id,
          target.workspace_id,
          targetId,
          a.mime,
          a.width,
          a.height,
          a.bytes,
          image.previewBytes,
          a.hash,
          a.fileKey,
          job.template_id,
        ],
      );
    }
    const document = canvasDocument.parse({
      ...manifest.document,
      nodes: manifest.document.nodes.map((n) => ({
        ...n,
        id: randomUUID(),
        assetId: ids.get(n.assetId!)!,
      })),
    });
    await this.c.query(
      "INSERT INTO project_documents(workspace_id,project_id,revision,document,request_key,request_hash) VALUES($1,$2,1,$3,$4,$5)",
      [
        target.workspace_id,
        plan.projectId,
        document,
        randomUUID(),
        createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      ],
    );
    for (const id of ids.values())
      await this.c.query(
        "INSERT INTO canvas_references(workspace_id,project_id,asset_id) VALUES($1,$2,$3)",
        [target.workspace_id, plan.projectId, id],
      );
    const draft = projectDraftDocument.parse({
      ...manifest.draft,
      referenceIds: manifest.draft.referenceIds.map((id) => ids.get(id)!),
    });
    await this.c.query(
      "INSERT INTO project_creation_drafts(workspace_id,project_id,revision,document,request_key,request_hash) VALUES($1,$2,1,$3,$4,$5)",
      [
        target.workspace_id,
        plan.projectId,
        draft,
        randomUUID(),
        createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
      ],
    );
    for (const id of draft.referenceIds)
      await this.c.query(
        "INSERT INTO draft_references(workspace_id,project_id,asset_id) VALUES($1,$2,$3)",
        [target.workspace_id, plan.projectId, id],
      );
    await this.c.query(
      "INSERT INTO demo_projects(workspace_id,project_id,template_id,images) VALUES($1,$2,$3,$4)",
      [
        target.workspace_id,
        plan.projectId,
        job.template_id,
        JSON.stringify(images),
      ],
    );
    await this.c.query(
      "UPDATE image_policies SET storage_reserved=storage_reserved-$2,storage_used=storage_used+$2 WHERE user_id=$1",
      [targetId, bytes],
    );
    await this.c.query(
      "UPDATE demo_provisioning SET state='ready',project_id=$2 WHERE user_id=$1",
      [targetId, plan.projectId],
    );
    return { state: "ready", projectId: plan.projectId };
  }
  async claimOpen(p: Principal) {
    const status = await this.status(p, p.id);
    if (status.state !== "ready") return status;
    const r = await this.c.query(
      "UPDATE demo_provisioning SET opened_at=now() WHERE user_id=$1 AND opened_at IS NULL RETURNING user_id",
      [p.id],
    );
    return { ...status, shouldOpen: !!r.rowCount };
  }
}
export class PgDemoStore implements DemoStore {
  private readonly tx: PgTransactions;
  constructor(private readonly pool: pg.Pool) {
    this.tx = new PgTransactions(pool);
  }
  publish(p: Principal, i: PublishDemoInput) {
    return this.tx.write((c) => new DemoRepository(c).publish(p, i), [p.id]);
  }
  template(p: Principal) {
    return this.tx.read((c) => new DemoRepository(c).template(p));
  }
  status(p: Principal, targetId: string) {
    return this.tx.read((c) => new DemoRepository(c).status(p, targetId));
  }
  project(p: Principal, id: string) {
    return this.tx.read((c) => new DemoRepository(c).project(p, id));
  }
  claimOpen(p: Principal) {
    return this.tx.write((c) => new DemoRepository(c).claimOpen(p), [p.id]);
  }
  async initialize(
    p: Principal,
    targetId: string,
    run: (r: DemoInitialization) => Promise<DemoStatus>,
  ): Promise<DemoStatus> {
    // Authenticate before acquiring a per-user session lock. Files are copied outside transactions.
    await this.status(p, targetId);
    const c = await this.pool.connect();
    let locked = false;
    const transact = async <T>(work: (r: DemoRepository) => Promise<T>) => {
      try {
        await c.query("BEGIN");
        await c.query(
          "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [[...new Set([p.id, targetId])].sort()],
        );
        const v = await work(new DemoRepository(c));
        await c.query("COMMIT");
        return v;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    };
    try {
      locked = (
        await c.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          ["demo-init:" + targetId],
        )
      ).rows[0].locked;
      if (!locked) return { state: "pending" };
      return await run({
        prepare: () => transact((r) => r.prepare(p, targetId)),
        complete: (w) => transact((r) => r.complete(p, targetId, w)),
        fail: async () => {
          await transact(async (r) => {
            await r.authorize(p, targetId);
            await c.query(
              "UPDATE demo_provisioning SET state='failed' WHERE user_id=$1 AND state<>'ready'",
              [targetId],
            );
          });
        },
      });
    } finally {
      if (locked)
        await c
          .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
            "demo-init:" + targetId,
          ])
          .catch(() => {});
      c.release();
    }
  }
}
