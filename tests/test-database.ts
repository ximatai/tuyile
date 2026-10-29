import { randomBytes } from "node:crypto";
import { createDatabase, PgStore, security } from "@tuyile/infrastructure";
import { Workbench } from "@tuyile/core";
import { migrate } from "../scripts/migrate.js";
export const testPassword = randomBytes(24).toString("base64url");
export function testUrls() {
  const runtime = process.env.DATABASE_URL ?? "",
    owner = process.env.MIGRATION_DATABASE_URL ?? "";
  for (const url of [runtime, owner]) {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "55440" ||
      parsed.pathname !== "/tuyile_test"
    )
      throw new Error("REFUSE_NON_TEST_DATABASE");
  }
  return { runtime, owner };
}
export async function resetDatabase() {
  const urls = testUrls();
  await migrate(urls.owner);
  const { pool: owner } = createDatabase(urls.owner);
  try {
    await owner.query(
      "TRUNCATE tuyile.sessions,tuyile.password_tokens,tuyile.workspace_members,tuyile.projects,tuyile.workspaces,tuyile.users,tuyile.login_limits,tuyile.image_provider_versions,tuyile.planning_provider_versions,tuyile.skill_versions,tuyile.tool_controls CASCADE",
    );
    await owner.query(
      "INSERT INTO tuyile.tool_controls(tool_id,version) VALUES('image.generate',1),('image.edit',1)",
    );
    await owner.query(
      "UPDATE tuyile.image_settings SET concurrency=2,queue_limit=64 WHERE id=1",
    );
  } finally {
    await owner.end();
  }
  const { pool } = createDatabase(urls.runtime);
  const store = new PgStore(pool);
  const service = new Workbench(store, security);
  await service.bootstrap("admin", testPassword);
  return { pool, store, service };
}
