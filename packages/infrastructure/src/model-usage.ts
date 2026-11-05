import type pg from "pg";
import {
  referenceCost,
  type ModelUsage,
  type ReferencePrice,
} from "@tuyile/core";
export async function recordModelUsage(
  c: pg.PoolClient,
  kind: "image" | "planning",
  id: string,
  usage: ModelUsage,
) {
  const table = kind === "image" ? "image_attempts" : "planning_attempts";
  const row = (
    await c.query(
      `SELECT price_snapshot,model_usage FROM ${table} WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!row || row.model_usage) return;
  const imageCost = referenceCost(
    usage,
    row.price_snapshot as ReferencePrice | null,
  );
  const totalCost = usage.svg
    ? imageCost !== null && usage.svg.referenceUsd !== null
      ? imageCost + usage.svg.referenceUsd
      : null
    : imageCost;
  await c.query(
    `UPDATE ${table} SET model_usage=$2,reference_usd=$3 WHERE id=$1`,
    [id, usage, totalCost],
  );
}
