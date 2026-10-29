import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
for (const [kind, port, web, api] of [
  ["dev", 55439, 5178, 8791],
  ["test", 55440, 5180, 8793],
  ["docker", 55441, 8792, 8792],
]) {
  const filename = kind === "dev" ? ".env" : `.env.${kind}`,
    db = `tuyile_${kind}`,
    admin = randomBytes(24).toString("hex"),
    migrator = randomBytes(24).toString("hex"),
    runtime = randomBytes(24).toString("hex");
  const body = `# Local generated credentials. Never commit or print.\nPOSTGRES_PASSWORD=${admin}\nMIGRATOR_PASSWORD=${migrator}\nRUNTIME_PASSWORD=${runtime}\nPOSTGRES_DB=${db}\nPG_PORT=${port}\nDATABASE_URL=postgresql://tuyile_runtime:${runtime}@127.0.0.1:${port}/${db}\nMIGRATION_DATABASE_URL=postgresql://tuyile_migrator:${migrator}@127.0.0.1:${port}/${db}\nAPP_ORIGIN=http://127.0.0.1:${web}\nPORT=${api}\nHOST=127.0.0.1\n`;
  try {
    await writeFile(filename, body, { flag: "wx", mode: 0o600 });
    console.log(`Created ${filename}`);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    console.log("Existing local configuration retained");
  }
}
await import("./upgrade-creation-env.mjs");
