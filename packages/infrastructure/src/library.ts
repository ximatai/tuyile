import type pg from "pg";
import {
  AppError,
  type LibraryStore,
  type LibraryRepository,
} from "@tuyile/core";
import type {
  PromptPickerQuery,
  StyleInput,
  SavedStyle,
  Principal,
  PromptTemplateInput,
  ManagedPromptTemplate,
  FavoriteInput,
  Favorite,
  GalleryAsset,
  AssetReference,
} from "@tuyile/contracts";
import { PgTransactions } from "./transactions.js";
import { PgCreationContext } from "./creation/context.js";
const styleRow = (r: any): SavedStyle => ({
  id: r.id,
  name: r.name,
  text: r.text,
  revision: r.revision,
  published: r.published,
  scope: r.workspace_id ? "personal" : "public",
});
const favorite = (r: any): Favorite => ({
  id: r.id,
  title: r.title,
  groupName: r.group_name,
  ...(r.asset_id ? { assetId: r.asset_id } : { prompt: r.prompt }),
  createdAt: r.created_at.toISOString(),
});
const managedPrompt = (r: any): ManagedPromptTemplate => ({
  id: r.id,
  title: r.title,
  category: r.category,
  prompt: r.prompt,
  published: r.published,
  featured: r.featured,
  revision: r.revision,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
class PgLibraryRepository
  extends PgCreationContext
  implements LibraryRepository
{
  async pickerItems(p: Principal, input: PromptPickerQuery) {
    await this.auth(this.c, p, false, false);
    const args = [
      p.workspaceId,
      input.offset,
      input.search,
      input.group ?? null,
    ];
    return (
      await this.c.query(
        input.source === "favorites"
          ? "SELECT id,title,prompt,group_name FROM library_favorites WHERE workspace_id=$1 AND prompt IS NOT NULL AND ($3='' OR strpos(lower(title||' '||prompt),lower($3))>0) AND ($4::text IS NULL OR group_name=$4) ORDER BY created_at DESC,id LIMIT 51 OFFSET $2"
          : "SELECT id,title,prompt,category AS group_name FROM prompt_templates WHERE published AND featured AND $1::uuid IS NOT NULL AND ($3='' OR strpos(lower(title||' '||prompt),lower($3))>0) AND ($4::text IS NULL OR category=$4) ORDER BY created_at,id LIMIT 51 OFFSET $2",
        args,
      )
    ).rows.map((r) => ({
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      groupName: r.group_name,
    }));
  }
  async pickerGroups(p: Principal, source: PromptPickerQuery["source"]) {
    await this.auth(this.c, p, false, false);
    return (
      await this.c.query(
        source === "favorites"
          ? "SELECT DISTINCT group_name AS name FROM library_favorites WHERE workspace_id=$1 AND prompt IS NOT NULL ORDER BY name LIMIT 200"
          : "SELECT DISTINCT category AS name FROM prompt_templates WHERE published AND featured AND $1::uuid IS NOT NULL ORDER BY name LIMIT 200",
        [p.workspaceId],
      )
    ).rows.map((r) => r.name as string);
  }
  async styles(p: Principal, managed: boolean) {
    await this.auth(this.c, p, managed, false);
    const rows = await this.c.query(
      managed
        ? "SELECT * FROM creation_styles WHERE workspace_id IS NULL AND NOT deleted ORDER BY created_at,id LIMIT 200"
        : "SELECT * FROM creation_styles WHERE NOT deleted AND (workspace_id=$1 OR (workspace_id IS NULL AND published)) ORDER BY created_at,id LIMIT 400",
      managed ? [] : [p.workspaceId],
    );
    return rows.rows.map(styleRow);
  }
  async saveStyle(p: Principal, input: StyleInput, shared: boolean) {
    await this.auth(this.c, p, shared);
    const owner = shared ? null : p.workspaceId;
    await this.c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "styles:" + (owner ?? "public"),
    ]);
    const existing = (
      await this.c.query(
        "SELECT workspace_id,deleted FROM creation_styles WHERE id=$1",
        [input.id],
      )
    ).rows[0];
    if (existing && (existing.workspace_id !== owner || existing.deleted))
      throw new AppError("NOT_FOUND", 404);
    if (input.revision === 0 && !existing) {
      const count = await this.c.query(
        "SELECT count(*) FROM creation_styles WHERE workspace_id IS NOT DISTINCT FROM $1::uuid AND NOT deleted",
        [owner],
      );
      if (Number(count.rows[0].count) >= 200)
        throw new AppError("STYLE_LIMIT", 409);
    }
    const args = [
      input.id,
      owner,
      input.name,
      input.text,
      shared ? input.published : false,
      input.revision,
    ];
    const row = (
      await this.c.query(
        input.revision === 0
          ? "INSERT INTO creation_styles(id,workspace_id,name,text,published) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING *"
          : "UPDATE creation_styles SET name=$3,text=$4,published=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id IS NOT DISTINCT FROM $2::uuid AND revision=$6 AND NOT deleted RETURNING *",
        input.revision === 0 ? args.slice(0, 5) : args,
      )
    ).rows[0];
    if (!row) throw new AppError("STYLE_CONFLICT", 409);
    if (shared)
      await this.c.query(
        "INSERT INTO administration_audit(actor_id,action,values) VALUES($1,'style-save',$2)",
        [
          p.id,
          { id: row.id, revision: row.revision, published: row.published },
        ],
      );
    return styleRow(row);
  }
  async removeStyle(p: Principal, id: string, revision: number) {
    await this.auth(this.c, p, false);
    const existing = (
      await this.c.query(
        "SELECT revision FROM creation_styles WHERE id=$1 AND workspace_id=$2 AND NOT deleted FOR UPDATE",
        [id, p.workspaceId],
      )
    ).rows[0];
    if (!existing) throw new AppError("NOT_FOUND", 404);
    if (existing.revision !== revision)
      throw new AppError("STYLE_CONFLICT", 409);
    await this.c.query(
      "UPDATE creation_styles SET deleted=true,revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [id, p.workspaceId],
    );
  }
  async prompts(p: Principal, offset: number, categories: string[]) {
    await this.auth(this.c, p, false, false);
    return (
      await this.c.query(
        "SELECT id,title,category,prompt FROM prompt_templates WHERE published AND (cardinality($2::text[])=0 OR category=ANY($2::text[])) ORDER BY created_at,id LIMIT 51 OFFSET $1",
        [offset, categories],
      )
    ).rows;
  }
  async promptCategories(p: Principal) {
    await this.auth(this.c, p, false, false);
    return (
      await this.c.query(
        "SELECT DISTINCT category FROM prompt_templates WHERE published ORDER BY category",
      )
    ).rows.map((r) => r.category as string);
  }
  async managedPrompts(p: Principal, offset: number, search: string) {
    await this.auth(this.c, p, true, false);
    return (
      await this.c.query(
        "SELECT * FROM prompt_templates WHERE $2='' OR strpos(lower(title),lower($2))>0 OR strpos(lower(category),lower($2))>0 ORDER BY created_at DESC,id LIMIT 51 OFFSET $1",
        [offset, search],
      )
    ).rows.map(managedPrompt);
  }
  async savePrompt(p: Principal, input: PromptTemplateInput) {
    await this.auth(this.c, p, true);
    const args = [
      input.id,
      input.title,
      input.category,
      input.prompt,
      input.published,
      input.revision,
      input.featured ?? null,
    ];
    const row = (
      await this.c.query(
        input.revision === 0
          ? "INSERT INTO prompt_templates(id,title,category,prompt,published,featured) VALUES($1,$2,$3,$4,$5,coalesce($6,false)) ON CONFLICT(id) DO NOTHING RETURNING *"
          : "UPDATE prompt_templates SET title=$2,category=$3,prompt=$4,published=$5,featured=coalesce($7,featured),revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$6 RETURNING *",
        input.revision === 0 ? [...args.slice(0, 5), args[6]] : args,
      )
    ).rows[0];
    if (!row) throw new AppError("PROMPT_TEMPLATE_CONFLICT", 409);
    await this.c.query(
      "INSERT INTO administration_audit(actor_id,action,values) VALUES($1,'prompt-template-save',$2)",
      [p.id, { id: row.id, revision: row.revision, published: row.published }],
    );
    return managedPrompt(row);
  }
  async assets(p: Principal, offset: number): Promise<GalleryAsset[]> {
    await this.auth(this.c, p, false, false);
    return (
      await this.c.query(
        "SELECT id,mime,width,height,bytes,created_at,task_id FROM image_assets WHERE workspace_id=$1 AND state='ready' ORDER BY created_at DESC,id LIMIT 51 OFFSET $2",
        [p.workspaceId, offset],
      )
    ).rows.map((r) => ({
      id: r.id,
      mime: r.mime,
      width: r.width,
      height: r.height,
      bytes: Number(r.bytes),
      createdAt: r.created_at.toISOString(),
      origin: r.task_id ? "generated" : "upload",
    }));
  }
  async favorites(p: Principal, offset: number, group?: string | string[]) {
    await this.auth(this.c, p, false, false);
    return (
      await this.c.query(
        "SELECT * FROM library_favorites WHERE workspace_id=$1 AND (cardinality($3::text[])=0 OR group_name=ANY($3::text[])) ORDER BY created_at DESC,id LIMIT 51 OFFSET $2",
        [
          p.workspaceId,
          offset,
          group === undefined ? [] : Array.isArray(group) ? group : [group],
        ],
      )
    ).rows.map(favorite);
  }
  async groups(p: Principal) {
    await this.auth(this.c, p, false, false);
    return (
      await this.c.query(
        "SELECT DISTINCT group_name FROM library_favorites WHERE workspace_id=$1 ORDER BY group_name LIMIT 200",
        [p.workspaceId],
      )
    ).rows.map((r) => r.group_name);
  }
  async saveFavorite(p: Principal, input: FavoriteInput) {
    await this.auth(this.c, p);
    if (
      input.assetId &&
      !(
        await this.c.query(
          "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state='ready' FOR UPDATE",
          [p.workspaceId, input.assetId],
        )
      ).rowCount
    )
      throw new AppError("REFERENCE_UNAVAILABLE", 409);
    const row = (
      await this.c.query(
        "INSERT INTO library_favorites(id,workspace_id,title,group_name,asset_id,prompt) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET title=excluded.title,group_name=excluded.group_name,asset_id=excluded.asset_id,prompt=excluded.prompt WHERE library_favorites.workspace_id=excluded.workspace_id RETURNING *",
        [
          input.id,
          p.workspaceId,
          input.title,
          input.groupName,
          input.assetId ?? null,
          input.prompt ?? null,
        ],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return favorite(row);
  }
  async removeFavorite(p: Principal, id: string) {
    await this.auth(this.c, p);
    if (
      !(
        await this.c.query(
          "DELETE FROM library_favorites WHERE workspace_id=$1 AND id=$2 RETURNING id",
          [p.workspaceId, id],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
  async references(p: Principal, id: string): Promise<AssetReference[]> {
    await this.auth(this.c, p, false, false);
    if (
      !(
        await this.c.query(
          "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=$2",
          [p.workspaceId, id],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
    return (
      await this.c.query(
        `SELECT 'canvas' kind,c.project_id id,p.name label,p.id project_id FROM canvas_references c JOIN projects p ON p.id=c.project_id WHERE c.workspace_id=$1 AND c.asset_id=$2
   UNION ALL SELECT 'task',t.id,'图片任务',t.project_id FROM image_references r JOIN image_tasks t ON t.id=r.task_id WHERE r.workspace_id=$1 AND r.asset_id=$2
   UNION ALL SELECT 'agent',j.id,'Agent 对话与计划',j.project_id FROM agent_references r JOIN planning_jobs j ON j.id=r.job_id WHERE r.workspace_id=$1 AND r.asset_id=$2
   UNION ALL SELECT 'favorite',f.id,f.title,NULL::uuid FROM library_favorites f WHERE f.workspace_id=$1 AND f.asset_id=$2
   UNION ALL SELECT 'task',d.id,'依赖此图片的步骤',d.project_id FROM image_outputs o JOIN image_tasks d ON d.depends_on=o.task_id WHERE o.workspace_id=$1 AND o.asset_id=$2 AND o.ordinal=0 AND (d.state IN ('queued','running') OR d.pending_review)
   LIMIT 50`,
        [p.workspaceId, id],
      )
    ).rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      label: r.label,
      projectId: r.project_id,
    }));
  }
}
export class PgLibraryStore implements LibraryStore {
  private readonly transactions: PgTransactions;
  constructor(pool: pg.Pool) {
    this.transactions = new PgTransactions(pool);
  }
  read<T>(run: (r: LibraryRepository) => Promise<T>) {
    return this.transactions.read((c) => run(new PgLibraryRepository(c, "")));
  }
  write<T>(owner: string, run: (r: LibraryRepository) => Promise<T>) {
    return this.transactions.write(
      (c) => run(new PgLibraryRepository(c, "")),
      [owner],
    );
  }
}
