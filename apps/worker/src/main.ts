import {
  loadConfig,
  createDatabase,
  assertSchema,
} from "@tuyile/infrastructure";
const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);
let stopping = false;
try {
  await assertSchema(pool);
  // Stage 1 validates the independent process lifecycle; task consumption is stage 2.
  console.log("WORKER_READY identity-foundation");
  const timer = setInterval(() => {
    void pool.query("SELECT 1").catch(() => {
      console.error("WORKER_DATABASE_UNAVAILABLE");
      void stop(1);
    });
  }, 5000);
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await pool.end();
    process.exit(code);
  }
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
} catch {
  console.error("WORKER_STARTUP_FAILED_CHECK_SCHEMA_AND_RUNTIME_ROLE");
  await pool.end();
  process.exitCode = 1;
}
