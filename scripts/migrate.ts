import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function migrate(url: string) {
  const c = new pg.Client({
    connectionString: url,
    options: "-c search_path=tuyile,pg_catalog",
  });
  await c.connect();
  try {
    if (
      !(
        await c.query(
          "SELECT has_schema_privilege(current_user,'tuyile','CREATE') AS allowed",
        )
      ).rows[0].allowed
    )
      throw new Error("MIGRATION_ROLE_REQUIRED");
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(72110402)");
    // This CREATE privilege is intentionally unavailable to the runtime role.
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const sql = await readFile(
      new URL("../migrations/0001_identity.sql", import.meta.url),
      "utf8",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    const old = (
      await c.query("SELECT checksum FROM schema_migrations WHERE version=1")
    ).rows[0];
    if (old && old.checksum !== checksum)
      throw new Error("MIGRATION_CHECKSUM_MISMATCH");
    if (!old) {
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)",
        [checksum],
      );
    }
    await c.query(
      "REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM tuyile_runtime",
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}
if (process.argv[1]?.endsWith("/migrate.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL_REQUIRED");
  migrate(url)
    .then(() => console.log("Migration complete"))
    .catch(() => {
      console.error("MIGRATION_FAILED");
      process.exitCode = 1;
    });
}
