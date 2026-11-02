import type { Hono } from "hono";
import type { AdministrationService } from "@tuyile/core";
import {
  executionSettingsInput,
  planningPolicyInput,
  id,
  pageOffset,
  z,
} from "@tuyile/contracts";
import type { ApiEnv } from "./app.js";
export function administrationRoutes(
  app: Hono<ApiEnv>,
  service: AdministrationService,
) {
  app.get("/api/admin/users/:id/artworks", async (c) => {
    const artworks = await service.artworks(
      c.get("session").user,
      id.parse(c.req.param("id")),
      pageOffset.parse(c.req.query("offset")),
    );
    return c.json({
      artworks: artworks.slice(0, 5),
      hasMore: artworks.length > 5,
    });
  });
  app.get("/api/admin/users/:id/artworks/:assetId/:variant", async (c) => {
    const variant = z
      .enum(["preview", "original"])
      .parse(c.req.param("variant"));
    const result = await service.bytes(
      c.get("session").user,
      id.parse(c.req.param("id")),
      id.parse(c.req.param("assetId")),
      variant === "preview",
    );
    c.header("Content-Type", result.mime);
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(Buffer.from(result.bytes));
  });
  app.get("/api/image-admin/execution-settings", async (c) =>
    c.json(await service.settings(c.get("session").user)),
  );
  app.post("/api/image-admin/execution-settings", async (c) => {
    await service.saveSettings(
      c.get("session").user,
      executionSettingsInput.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
  app.get("/api/image-admin/planning-policies/:id", async (c) =>
    c.json(
      await service.policy(c.get("session").user, id.parse(c.req.param("id"))),
    ),
  );
  app.post("/api/image-admin/planning-policies/:id", async (c) => {
    await service.savePolicy(
      c.get("session").user,
      id.parse(c.req.param("id")),
      planningPolicyInput.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
  app.get("/api/image-admin/summary", async (c) =>
    c.json(await service.summary(c.get("session").user)),
  );
}
