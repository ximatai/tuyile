import { readFile, appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
for (const name of [".env", ".env.test", ".env.docker"]) {
  const current = await readFile(name, "utf8");
  const entries = [];
  if (!/^APP_MASTER_KEY=/m.test(current))
    entries.push(`APP_MASTER_KEY=${randomBytes(32).toString("hex")}`);
  if (!/^STORAGE_DIR=/m.test(current))
    entries.push(
      `STORAGE_DIR=.codex-temp/${name === ".env.test" ? "test" : "dev"}-storage`,
    );
  if (entries.length) await appendFile(name, "\n" + entries.join("\n") + "\n");
}
console.log(
  "Missing local creation settings initialized; existing values preserved",
);
