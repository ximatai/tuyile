import type { Hono } from "hono";
import type { AgentService } from "@tuyile/core";
import {
  id,
  z,
  planningRequest,
  planRevisionInput,
  pageOffset,
} from "@tuyile/contracts";
import type { ApiEnv } from "./app.js";
export function agentRoutes(app: Hono<ApiEnv>, service: AgentService) {
  app.post("/api/agent/projects/:id/clear", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    await service.clearHistory(
      c.get("session").user,
      id.parse(c.req.param("id")),
    );
    return c.json({ ok: true });
  });
  app.post("/api/agent/jobs/:id/cancel", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    await service.cancelJob(c.get("session").user, id.parse(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.post("/api/agent/plans/:id/cancel", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    await service.cancelPlan(
      c.get("session").user,
      id.parse(c.req.param("id")),
    );
    return c.json({ ok: true });
  });
  app.post("/api/agent/planning", async (c) =>
    c.json(
      await service.request(
        c.get("session").user,
        planningRequest.parse(await c.req.json()),
      ),
      202,
    ),
  );
  app.get("/api/agent/jobs", async (c) =>
    c.json({
      jobs: await service.jobs(
        c.get("session").user,
        id.parse(c.req.query("projectId")),
        pageOffset.parse(c.req.query("offset")),
      ),
    }),
  );
  app.get("/api/agent/usage", async (c) =>
    c.json(await service.usage(c.get("session").user)),
  );
  app.post("/api/agent/jobs/:id/revisions", async (c) =>
    c.json(
      await service.revise(
        c.get("session").user,
        id.parse(c.req.param("id")),
        planRevisionInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/agent/plans/:id/confirm", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    return c.json(
      {
        tasks: await service.confirm(
          c.get("session").user,
          id.parse(c.req.param("id")),
        ),
      },
      202,
    );
  });
}
