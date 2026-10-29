import type { Hono } from "hono";
import type { AdministrationService } from "@tuyile/core";
import {
  executionSettingsInput,
  planningPolicyInput,
  id,
} from "@tuyile/contracts";
import type { ApiEnv } from "./app.js";
export function administrationRoutes(
  app: Hono<ApiEnv>,
  service: AdministrationService,
) {
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
