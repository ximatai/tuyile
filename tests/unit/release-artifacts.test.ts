import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";

const script = resolve("scripts/check-release.mjs");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function repository() {
  await mkdir(".codex-temp", { recursive: true });
  const path = await mkdtemp(resolve(".codex-temp/release-guard-"));
  temporary.push(path);
  execFileSync("git", ["init", "-q"], { cwd: path });
  await mkdir(`${path}/licenses`);
  for (const file of [
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "licenses/gpt-image-canvas-MIT.txt",
  ])
    await writeFile(`${path}/${file}`, "Synthetic license fixture\n");
  await writeFile(
    `${path}/package.json`,
    JSON.stringify({ name: "synthetic", private: true, license: "Apache-2.0" }),
  );
  execFileSync("git", ["add", "."], { cwd: path });
  return path;
}
function run(path: string) {
  return spawnSync(process.execPath, [script], { cwd: path, encoding: "utf8" });
}
it("accepts indexed source and the example env, without reading ignored private working files", async () => {
  const path = await repository();
  await writeFile(
    `${path}/.env.example`,
    "APP_MASTER_KEY=replace-with-generated-64-hex-characters\n",
  );
  execFileSync("git", ["add", ".env.example"], { cwd: path });
  await writeFile(`${path}/.env`, "not part of the Git index\n");
  expect(run(path).status).toBe(0);
});
it("rejects staged credentials even after an unstaged redaction and never prints their value", async () => {
  const path = await repository();
  const value = ["sk", "-", "aB7cD9".repeat(8)].join("");
  await writeFile(
    `${path}/source.ts`,
    `export const credential = "${value}";\n`,
  );
  execFileSync("git", ["add", "source.ts"], { cwd: path });
  await writeFile(
    `${path}/source.ts`,
    "export const credential = 'redacted';\n",
  );
  const result = run(path);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("source.ts: secret-like content");
  expect(result.stderr + result.stdout).not.toContain(value);
});
it("rejects private resources and symlinks in the index", async () => {
  const path = await repository();
  await writeFile(`${path}/.env`, "synthetic fixture\n");
  await writeFile(`${path}/backup.dump`, "synthetic fixture\n");
  await symlink(".env", `${path}/private-link`);
  execFileSync("git", ["add", ".env", "backup.dump", "private-link"], {
    cwd: path,
  });
  const result = run(path);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(".env: private/generated artifact");
  expect(result.stderr).toContain("backup.dump: private/generated artifact");
  expect(result.stderr).toContain("private-link: non-regular tracked file");
});
