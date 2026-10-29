import type { Hono } from "hono";
import type { CreationService } from "@tuyile/core";
import {
  imageInput,
  providerInput,
  policyInput,
  id,
  pageOffset,
  z,
} from "@tuyile/contracts";
import { AppError } from "@tuyile/core";
import type { ApiEnv } from "./app.js";
export function creationRoutes(app: Hono<ApiEnv>, service: CreationService) {
  app.get("/api/images/usage", async (c) =>
    c.json(await service.usage(c.get("session").user)),
  );
  app.post("/api/images/tasks", async (c) =>
    c.json(
      await service.submit(
        c.get("session").user,
        imageInput.parse(await c.req.json()),
      ),
      202,
    ),
  );
  app.get("/api/images/tasks", async (c) => {
    const tasks = await service.tasks(
      c.get("session").user,
      c.req.query("projectId") ? id.parse(c.req.query("projectId")) : undefined,
      pageOffset.parse(c.req.query("offset")),
    );
    return c.json({ tasks: tasks.slice(0, 50), hasMore: tasks.length > 50 });
  });
  app.get("/api/images/recover", async (c) =>
    c.json(
      await service.recover(
        c.get("session").user,
        id.parse(c.req.query("projectId")),
        id.parse(c.req.query("requestKey")),
      ),
    ),
  );
  app.get("/api/images/tasks/:id", async (c) =>
    c.json(
      await service.task(c.get("session").user, id.parse(c.req.param("id"))),
    ),
  );
  app.post("/api/images/tasks/:id/cancel", async (c) => {
    await service.cancel(c.get("session").user, id.parse(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.get("/api/images/uploads", async (c) => {
    const assets = await service.uploads(
      c.get("session").user,
      pageOffset.parse(c.req.query("offset")),
    );
    return c.json({
      assets: assets.slice(0, 50).map((a) => ({
        id: a.id,
        width: a.width,
        height: a.height,
        mime: a.mime,
        bytes: a.bytes,
      })),
      hasMore: assets.length > 50,
    });
  });
  app.post("/api/images/uploads", async (c) => {
    const a = await service.upload(
      c.get("session").user,
      new Uint8Array(await c.req.arrayBuffer()),
    );
    return c.json(
      {
        id: a.id,
        mime: a.mime,
        width: a.width,
        height: a.height,
        bytes: a.bytes,
      },
      201,
    );
  });
  app.get("/api/images/assets/:id/:variant", async (c) => {
    const variant = c.req.param("variant");
    if (!["original", "preview", "download"].includes(variant))
      throw new AppError("NOT_FOUND", 404);
    const { asset, bytes } = await service.bytes(
      c.get("session").user,
      id.parse(c.req.param("id")),
      variant === "preview",
    );
    c.header("Content-Type", variant === "preview" ? "image/webp" : asset.mime);
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Disposition",
      `${variant === "download" ? "attachment" : "inline"}; filename="${asset.id}.${variant === "preview" ? "webp" : asset.mime.split("/")[1]}"`,
    );
    return c.body(Buffer.from(bytes));
  });
  app.post("/api/images/assets/:id/delete", async (c) => {
    await service.delete(c.get("session").user, id.parse(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.use("/api/image-admin/*", async (c, next) => {
    if (c.get("session").user.role !== "admin")
      throw new AppError("FORBIDDEN", 403);
    await next();
  });
  app.get("/api/image-admin/providers", async (c) =>
    c.json({ providers: await service.providers(c.get("session").user) }),
  );
  app.post("/api/image-admin/providers", async (c) =>
    c.json(
      await service.saveProvider(
        c.get("session").user,
        providerInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/image-admin/providers/:id/revoke", async (c) => {
    await service.revokeProvider(
      c.get("session").user,
      id.parse(c.req.param("id")),
    );
    return c.json({ ok: true });
  });
  app.get("/api/image-admin/policies/:id", async (c) =>
    c.json(
      await service.getPolicy(
        c.get("session").user,
        id.parse(c.req.param("id")),
      ),
    ),
  );
  app.post("/api/image-admin/policies/:id", async (c) => {
    await service.setPolicy(
      c.get("session").user,
      id.parse(c.req.param("id")),
      policyInput.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
  app.get("/api/image-admin/review", async (c) =>
    c.json({ tasks: await service.review(c.get("session").user) }),
  );
  app.post("/api/image-admin/review/:id", async (c) => {
    const input = z
      .object({
        confirmed: z.literal(0),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(await c.req.json());
    await service.resolve(
      c.get("session").user,
      id.parse(c.req.param("id")),
      input.confirmed,
      input.reason,
    );
    return c.json({ ok: true });
  });
}
