import type { Hono } from "hono";
import { id, canvasSave } from "@tuyile/contracts";
import type { CanvasService } from "@tuyile/core";
import type { ApiEnv } from "./app.js";
export function canvasRoutes(app: Hono<ApiEnv>, service: CanvasService) {
  app.get("/api/projects/:id/canvas", async (c) =>
    c.json(
      await service.load(c.get("session").user, id.parse(c.req.param("id"))),
    ),
  );
  app.post("/api/projects/:id/canvas", async (c) =>
    c.json(
      await service.save(
        c.get("session").user,
        id.parse(c.req.param("id")),
        canvasSave.parse(await c.req.json()),
      ),
    ),
  );
  app.post("/api/projects/:id/canvas/copy", async (c) =>
    c.json(
      await service.copy(
        c.get("session").user,
        id.parse(c.req.param("id")),
        canvasSave.parse(await c.req.json()),
      ),
    ),
  );
  app.get("/api/projects/:id/canvas/outputs", async (c) =>
    c.json(
      await service.pendingSnapshot(
        c.get("session").user,
        id.parse(c.req.param("id")),
      ),
    ),
  );
  app.get("/api/projects/:id/canvas/sources", async (c) =>
    c.json(
      await service.sources(c.get("session").user, id.parse(c.req.param("id"))),
    ),
  );
}
