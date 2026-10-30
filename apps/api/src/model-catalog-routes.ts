import type { Hono } from "hono";
import type { ModelCatalogService } from "@tuyile/core";
import {
  id,
  z,
  modelId,
  modelServiceInput,
  poolPublication,
} from "@tuyile/contracts";
import type { ApiEnv } from "./app.js";
export function modelCatalogRoutes(app: Hono<ApiEnv>, s: ModelCatalogService) {
  app.get("/api/models", async (c) =>
    c.json(await s.userPools(c.get("session").user)),
  );
  app.get("/api/model-admin/catalog", async (c) =>
    c.json(await s.snapshot(c.get("session").user)),
  );
  app.post("/api/model-admin/bootstrap", async (c) => {
    await s.bootstrap(c.get("session").user);
    return c.json({ ok: true });
  });
  app.post("/api/model-admin/services", async (c) =>
    c.json(
      await s.saveService(
        c.get("session").user,
        modelServiceInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/model-admin/services/:id/refresh", async (c) => {
    await s.refresh(c.get("session").user, id.parse(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.post("/api/model-admin/services/:id/manual", async (c) => {
    const input = z
      .object({ modelId })
      .strict()
      .parse(await c.req.json());
    await s.manual(
      c.get("session").user,
      id.parse(c.req.param("id")),
      input.modelId,
    );
    return c.json({ ok: true });
  });
  app.post("/api/model-admin/services/:id/state", async (c) => {
    const input = z
      .object({
        revision: z.number().int().nonnegative(),
        enabled: z.boolean(),
        revoke: z.boolean().default(false),
      })
      .strict()
      .parse(await c.req.json());
    await s.state(
      c.get("session").user,
      id.parse(c.req.param("id")),
      input.revision,
      input.enabled,
      input.revoke,
    );
    return c.json({ ok: true });
  });
  app.post("/api/model-admin/pools", async (c) => {
    await s.publish(
      c.get("session").user,
      poolPublication.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
}
