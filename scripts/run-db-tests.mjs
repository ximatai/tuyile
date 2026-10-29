import { mkdir, open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
await mkdir(".codex-temp", { recursive: true });
const lockPath = ".codex-temp/database-tests.lock";
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(
      "DATABASE_TESTS_ALREADY_RUNNING: run integration/runtime/e2e/recovery sequentially; if interrupted, verify no test process remains before removing .codex-temp/database-tests.lock",
    );
    process.exit(1);
  }
  throw error;
}
await lock.writeFile(String(process.pid));
await lock.close();
async function run(args) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  const interrupt = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    return await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
try {
  if (process.argv[2] === "integration")
    process.exitCode = await run([
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration",
      "--maxWorkers=1",
    ]);
  else if (process.argv[2] === "recovery")
    process.exitCode = await run([
      "--import",
      "tsx",
      "tests/recovery/local-recovery.ts",
    ]);
  else if (["e2e", "runtime"].includes(process.argv[2])) {
    const prepared = await run(["--import", "tsx", "scripts/test-prepare.ts"]);
    process.exitCode =
      prepared === 0
        ? await run(
            process.argv[2] === "runtime"
              ? ["scripts/runtime-smoke.mjs"]
              : ["node_modules/@playwright/test/cli.js", "test"],
          )
        : prepared;
  } else throw new Error("UNKNOWN_DATABASE_TEST_SUITE");
} finally {
  await unlink(lockPath);
}
