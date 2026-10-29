import { Workbench } from "@tuyile/core";
import { username, password } from "@tuyile/contracts";
import {
  createDatabase,
  PgStore,
  security,
  loadConfig,
  assertSchema,
} from "@tuyile/infrastructure";
const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);
try {
  await assertSchema(pool);
  const name = username.parse(process.env.ADMIN_USERNAME),
    secret = password.parse(process.env.ADMIN_PASSWORD);
  await new Workbench(new PgStore(pool), security).bootstrap(name, secret);
  console.log("Administrator initialized");
} catch {
  console.error("ADMIN_INIT_FAILED_CHECK_INPUT_OR_EXISTING_ACCOUNT");
  process.exitCode = 1;
} finally {
  await pool.end();
}
