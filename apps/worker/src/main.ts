import {
  AgentService,
  ImageOperations,
  createToolRegistry,
} from "@tuyile/core";
import {
  loadConfig,
  createDatabase,
  assertSchema,
  creationConfig,
  PrivateImageFiles,
  PgCreationStore,
  CompatibleImageProvider,
  ImageWorker,
  PlanningLane,
  CompatiblePlanningProvider,
} from "@tuyile/infrastructure";
const config = loadConfig(),
  images = creationConfig(),
  { pool } = createDatabase(config.databaseUrl);
let stopping = false;
const creationStore = new PgCreationStore(
  pool,
  images.masterKey,
  images.fakeAllowed,
);
const files = new PrivateImageFiles(images.root);
const worker = new ImageWorker(
  pool,
  new ImageOperations(creationStore),
  files,
  new CompatibleImageProvider(images.fakeAllowed, images.fakeDelay),
  () => {
    console.error("WORKER_LOCK_OR_DATABASE_LOST");
    process.exit(1);
  },
  createToolRegistry(),
  new PlanningLane(
    new AgentService(creationStore, files),
    new CompatiblePlanningProvider(images.fakeAllowed),
  ),
);
try {
  await assertSchema(pool);
  await worker.start();
  console.log("WORKER_READY image-queue");
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    await worker.stop();
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
} catch {
  console.error("WORKER_STARTUP_FAILED_CHECK_SCHEMA_ROLE_OR_SINGLE_INSTANCE");
  await pool.end();
  process.exitCode = 1;
}
