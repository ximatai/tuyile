import { readFile } from "node:fs/promises";
import { CreationService } from "@tuyile/core";
import {
  creationConfig,
  PrivateImageFiles,
  PgCreationRepository,
} from "@tuyile/infrastructure";
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
const imageConfig = creationConfig();
const files = new PrivateImageFiles(imageConfig.root);
await files.init();
const creation = new CreationService(
  new PgCreationRepository(
    pool,
    imageConfig.masterKey,
    imageConfig.fakeAllowed,
  ),
  files,
);
const app = createApp(
  new Workbench(new PgStore(pool), security),
  new PgStore(pool),
  config,
  () => assertSchema(pool),
  (c) => getConnInfo(c).remote.address ?? "unknown",
  creation,
);
// Public app shell contains no private data. API routes always run first.
app.get("/assets/*", serveStatic({ root: "./apps/web/dist" }));
app.get("*", async (c) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/"))
    return c.json(
      { error: { code: "NOT_FOUND", requestId: c.get("requestId") } },
      404,
    );
  const html = await readFile("./apps/web/dist/index.html", "utf8");
  c.header("Cache-Control", "no-store");
  return c.html(
    html.replace(
      "</head>",
      `<meta name="csp-nonce" content="${c.get("styleNonce")}"/></head>`,
    ),
  );
});
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
