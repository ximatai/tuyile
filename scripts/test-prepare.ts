import { mkdir, writeFile } from "node:fs/promises";
import { resetDatabase, testPassword } from "../tests/test-database.js";
const db = await resetDatabase();
await db.pool.end();
await mkdir(".codex-temp", { recursive: true });
await writeFile(
  ".codex-temp/e2e-auth.json",
  JSON.stringify({ username: "admin", password: testPassword }),
  { mode: 0o600 },
);
console.log("Isolated test database prepared");
