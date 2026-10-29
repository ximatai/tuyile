import type { Hono } from "hono";
import type { ExtensionService } from "@tuyile/core";
import {
  id,
  z,
  planningProviderInput,
  skillInput,
  extensionState,
  toolBinding,
} from "@tuyile/contracts";
import type { ApiEnv } from "./app.js";
export function extensionRoutes(app: Hono<ApiEnv>, s: ExtensionService) {
  app.get("/api/skills", async (c) =>
    c.json({ skills: await s.skills(c.get("session").user) }),
  );
  app.get("/api/image-admin/planning-providers", async (c) =>
    c.json({ providers: await s.planningProviders(c.get("session").user) }),
  );
  app.post("/api/image-admin/planning-providers", async (c) =>
    c.json(
      await s.savePlanning(
        c.get("session").user,
        planningProviderInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/image-admin/planning-providers/:id/revoke", async (c) => {
    await s.revokePlanning(c.get("session").user, id.parse(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.get("/api/image-admin/skills", async (c) =>
    c.json({ skills: await s.skills(c.get("session").user, true) }),
  );
  app.post("/api/image-admin/skills", async (c) =>
    c.json(
      await s.saveSkill(
        c.get("session").user,
        skillInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/image-admin/skills/:id/state", async (c) => {
    const state = extensionState.parse(await c.req.json());
    await s.setSkill(
      c.get("session").user,
      id.parse(c.req.param("id")),
      state.enabled,
      state.revoked,
    );
    return c.json({ ok: true });
  });
  app.get("/api/image-admin/tools", async (c) =>
    c.json({ tools: await s.tools(c.get("session").user) }),
  );
  app.post("/api/image-admin/tools/:tool/:version/state", async (c) => {
    const binding = toolBinding.parse({
      id: c.req.param("tool"),
      version: z.coerce.number().int().parse(c.req.param("version")),
    });
    const state = extensionState.parse(await c.req.json());
    await s.setTool(
      c.get("session").user,
      binding,
      state.enabled,
      state.revoked,
    );
    return c.json({ ok: true });
  });
}
