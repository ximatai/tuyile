import { open, unlink } from "node:fs/promises";
import { Workbench } from "@tuyile/core";
import { username } from "@tuyile/contracts";
import {
  createDatabase,
  PgStore,
  security,
  loadConfig,
  assertSchema,
} from "@tuyile/infrastructure";
const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);
let output: Awaited<ReturnType<typeof open>> | undefined;
const filename = process.env.ADMIN_RECOVERY_FILE;
try {
  if (!filename) throw new Error("RECOVERY_FILE_REQUIRED");
  const name = username.parse(process.env.ADMIN_USERNAME);
  await assertSchema(pool);
  output = await open(filename, "wx", 0o600);
  const result = await new Workbench(new PgStore(pool), security).recoverAdmin(
    name,
  );
  await output.writeFile(
    JSON.stringify({
      url: `${config.origin}/login#reset=${result.token}`,
      expiresAt: result.expiresAt,
    }) + "\n",
  );
  console.log("Recovery link written to the requested private file");
} catch {
  if (output && filename) await unlink(filename).catch(() => {});
  console.error("ADMIN_RECOVERY_FAILED_CHECK_INPUT_ACCOUNT_AND_OUTPUT_FILE");
  process.exitCode = 1;
} finally {
  await output?.close();
  await pool.end();
}
