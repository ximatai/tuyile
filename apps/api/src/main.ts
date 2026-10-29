import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Workbench } from "@tuyile/core";
import {
  loadConfig,
  createDatabase,
  PgStore,
  security,
  assertSchema,
} from "@tuyile/infrastructure";
import { createApp } from "./app.js";
const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);
try {
  await assertSchema(pool);
} catch {
  console.error("STARTUP_FAILED_CHECK_SCHEMA_AND_RUNTIME_ROLE");
  await pool.end();
  process.exit(1);
}
const app = createApp(
  new Workbench(new PgStore(pool), security),
  new PgStore(pool),
  config,
  () => assertSchema(pool),
  (c) => getConnInfo(c).remote.address ?? "unknown",
);
// Public app shell contains no private data. API routes always run first.
app.get("/assets/*", serveStatic({ root: "./apps/web/dist" }));
app.get("*", serveStatic({ path: "./apps/web/dist/index.html" }));
const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  () => console.log(`API_READY port=${config.port}`),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  server.close(() => {
    void pool.end().then(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
