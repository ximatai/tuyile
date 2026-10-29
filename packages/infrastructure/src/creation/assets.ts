import type { AssetRow } from "./rows.js";
import type { PreparedAsset } from "@tuyile/core";

import {
  AppError,
  ASSET_RESERVE,
  type StoredAsset,
  type AssetBytes,
} from "@tuyile/core";
import type { Principal } from "@tuyile/contracts";
import { PgCreationContext, asset } from "./context.js";
export class PgAssetsRepository extends PgCreationContext {
  async uploads(p: Principal, offset = 0) {
    const c = this.c;

    await this.auth(c, p, false, false);
    return (
      await c.query<AssetRow>(
        "SELECT * FROM image_assets WHERE workspace_id=$1 AND task_id IS NULL AND state='ready' ORDER BY created_at DESC,id LIMIT 51 OFFSET $2",
        [p.workspaceId, offset],
      )
    ).rows.map(asset);
  }
  async reserveUpload(p: Principal) {
    const c = this.c;

    await this.auth(c, p);
    const limits = await this.ensure(c, p.id);
    if (
      Number(limits.storage_used) +
        Number(limits.storage_reserved) +
        ASSET_RESERVE >
      Number(limits.storage_limit)
    )
      throw new AppError("STORAGE_QUOTA", 409);
    await c.query(
      "UPDATE image_policies SET storage_reserved=storage_reserved+$2 WHERE user_id=$1",
      [p.id, ASSET_RESERVE],
    );
    return asset(
      (
        await c.query<AssetRow>(
          "INSERT INTO image_assets(workspace_id,user_id,state,reserved_bytes) VALUES($1,$2,'staging',$3) RETURNING *",
          [p.workspaceId, p.id, ASSET_RESERVE],
        )
      ).rows[0],
    );
  }
  async prepareCommit(
    a: StoredAsset,
    image: AssetBytes,
  ): Promise<PreparedAsset | null> {
    const c = this.c;

    const row = (
      await c.query<AssetRow>(
        "SELECT * FROM image_assets WHERE id=$1 FOR UPDATE",
        [a.id],
      )
    ).rows[0];
    if (row?.state === "ready") return null;
    if (row?.state !== "staging")
      throw new AppError("ASSET_WRITE_EXPIRED", 409);
    if (
      image.original.length + image.preview.length >
      Number(row.reserved_bytes)
    )
      throw new AppError("STORAGE_QUOTA", 409);
    return {
      ...asset(row),
      ordinal: row.ordinal,
      reservedBytes: Number(row.reserved_bytes),
    };
  }
  async publish(a: PreparedAsset, image: AssetBytes) {
    const c = this.c;
    await c.query(
      "UPDATE image_assets SET state='ready',mime=$2,width=$3,height=$4,bytes=$5,preview_bytes=$6,hash=$7,reserved_bytes=0 WHERE id=$1",
      [
        a.id,
        image.mime,
        image.width,
        image.height,
        image.original.length,
        image.preview.length,
        image.hash,
      ],
    );
    await c.query(
      "UPDATE image_policies SET storage_used=storage_used+$2,storage_reserved=storage_reserved-$3 WHERE user_id=$1",
      [a.userId, image.original.length + image.preview.length, a.reservedBytes],
    );
  }
  async pin(p: Principal, taskId: string, referenceIds: string[]) {
    for (const id of new Set(referenceIds)) {
      const found = await this.c.query(
        "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state='ready' FOR UPDATE",
        [p.workspaceId, id],
      );
      if (!found.rowCount) throw new AppError("REFERENCE_UNAVAILABLE", 404);
      await this.c.query(
        "INSERT INTO image_references(workspace_id,task_id,asset_id) VALUES($1,$2,$3)",
        [p.workspaceId, taskId, id],
      );
    }
  }
  async abandonAsset(a: StoredAsset) {
    const c = this.c;

    const r = await c.query(
      "UPDATE image_assets SET state='deleting' WHERE id=$1 AND state='staging' RETURNING id",
      [a.id],
    );
    return !!r.rowCount;
  }
  async asset(p: Principal, id: string) {
    const c = this.c;

    await this.auth(c, p, false, false);
    const r = (
      await c.query<AssetRow>(
        "SELECT * FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state='ready'",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    return asset(r);
  }
  async deleteAsset(p: Principal, id: string) {
    const c = this.c;

    await this.auth(c, p);
    const r = (
      await c.query<AssetRow>(
        "SELECT * FROM image_assets WHERE workspace_id=$1 AND id=$2 AND state IN ('ready','deleting') FOR UPDATE",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    if (
      (
        await c.query(
          "SELECT 1 FROM image_references WHERE asset_id=$1 LIMIT 1",
          [id],
        )
      ).rowCount
    )
      throw new AppError("ASSET_REFERENCED", 409);
    await c.query("UPDATE image_assets SET state='deleting' WHERE id=$1", [id]);
    return asset(r);
  }
  async finalizeDelete(a: StoredAsset) {
    const c = this.c;

    const r = (
      await c.query<AssetRow>(
        "SELECT * FROM image_assets WHERE id=$1 AND state='deleting' FOR UPDATE",
        [a.id],
      )
    ).rows[0];
    if (!r) return;
    await c.query(
      "UPDATE image_policies SET storage_used=storage_used-$2,storage_reserved=storage_reserved-$3 WHERE user_id=$1",
      [
        r.user_id,
        Number(r.bytes) + Number(r.preview_bytes),
        Number(r.reserved_bytes),
      ],
    );
    await c.query(
      "UPDATE image_assets SET state='deleted',bytes=0,preview_bytes=0,reserved_bytes=0 WHERE id=$1",
      [a.id],
    );
  }
  async staleAssets() {
    const c = this.c;
    return (
      await c.query<AssetRow>(
        "SELECT * FROM image_assets WHERE state='deleting' OR (state='staging' AND created_at<now()-interval '10 minutes') LIMIT 100",
      )
    ).rows.map(asset);
  }
}
