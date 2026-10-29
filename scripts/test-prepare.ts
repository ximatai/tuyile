import { ImageOperations } from "@tuyile/core";
import { PgCreationStore } from "@tuyile/infrastructure";
import { mkdir, writeFile } from "node:fs/promises";
import { resetDatabase, testPassword } from "../tests/test-database.js";
const db = await resetDatabase();
const s = await db.service.login("admin", testPassword);
const p = (await db.service.authenticate(s.token)).user;
await new ImageOperations(
  new PgCreationStore(db.pool, process.env.APP_MASTER_KEY!, true),
).saveProvider(p, {
  mode: "fake",
  baseUrl: "",
  models: ["test-image"],
  preserveKey: false,
});
await db.service.logout(s.token);
await db.pool.end();
await mkdir(".codex-temp", { recursive: true });
await writeFile(
  ".codex-temp/e2e-auth.json",
  JSON.stringify({ username: "admin", password: testPassword }),
  { mode: 0o600 },
);
console.log("Isolated test database prepared");
