import {
  loadConfig,
  createDatabase,
  assertSchema,
  creationConfig,
  PrivateImageFiles,
  PgCreationRepository,
  CompatibleImageProvider,
  ImageWorker,
} from "@tuyile/infrastructure";
const config = loadConfig(),
  images = creationConfig(),
  { pool } = createDatabase(config.databaseUrl);
let stopping = false;
const worker = new ImageWorker(
  pool,
  new PgCreationRepository(pool, images.masterKey, images.fakeAllowed),
  new PrivateImageFiles(images.root),
  new CompatibleImageProvider(images.fakeAllowed, images.fakeDelay),
  () => {
    console.error("WORKER_LOCK_OR_DATABASE_LOST");
    process.exit(1);
  },
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
