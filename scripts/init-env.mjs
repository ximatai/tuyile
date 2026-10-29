import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
for (const test of [false, true]) {
  const suffix = test ? "test" : "dev",
    db = `tuyile_${suffix}`,
    port = test ? 55440 : 55439;
  const admin = randomBytes(24).toString("hex"),
    migrator = randomBytes(24).toString("hex"),
    runtime = randomBytes(24).toString("hex");
  const body = `# Local generated credentials. Never commit or print.\nPOSTGRES_PASSWORD=${admin}\nMIGRATOR_PASSWORD=${migrator}\nRUNTIME_PASSWORD=${runtime}\nPOSTGRES_DB=${db}\nPG_PORT=${port}\nDATABASE_URL=postgresql://tuyile_runtime:${runtime}@127.0.0.1:${port}/${db}\nMIGRATION_DATABASE_URL=postgresql://tuyile_migrator:${migrator}@127.0.0.1:${port}/${db}\nAPP_ORIGIN=http://127.0.0.1:${test ? 5180 : 5178}\nPORT=${test ? 8793 : 8791}\nHOST=127.0.0.1\n`;
  try {
    await writeFile(test ? ".env.test" : ".env", body, {
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Created ${test ? ".env.test" : ".env"}`);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    console.log("Existing local configuration retained");
  }
}
