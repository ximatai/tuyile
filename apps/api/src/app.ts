import { modelCatalogRoutes } from "./model-catalog-routes.js";
import { administrationRoutes } from "./administration-routes.js";
import type { AdministrationService } from "@tuyile/core";
import { libraryRoutes } from "./library-routes.js";
import type { LibraryService } from "@tuyile/core";
import { agentRoutes } from "./agent-routes.js";
import type { AgentService } from "@tuyile/core";
import { canvasRoutes } from "./canvas-routes.js";
import type { CanvasService } from "@tuyile/core";
import { extensionRoutes } from "./extension-routes.js";
import type { ExtensionService } from "@tuyile/core";
import { creationRoutes } from "./creation-routes.js";
import type { CreationService } from "@tuyile/core";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import {
  z,
  loginInput,
  pageOffset,
  userSearch,
  createUserInput,
  redeemInput,
  changePasswordInput,
  createProjectInput,
  id,
  type SessionView,
} from "@tuyile/contracts";
import { AppError, type Workbench, type Store } from "@tuyile/core";
import { security } from "@tuyile/infrastructure";
import type { Context } from "hono";
// DTO validation and HTTP concerns stay here; the core never reads cookies or requests.
export type ApiEnv = {
  Variables: { session: SessionView; requestId: string; styleNonce: string };
};
const cookieName = "tuyile_session";
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createApp(
  service: Workbench,
  store: Store,
  config: { origin: string; production: boolean },
  ready: () => Promise<void>,
  clientAddress: (c: Context) => string = () => "direct",
  creation?: CreationService,
  extensions?: ExtensionService,
  canvas?: CanvasService,
  agent?: AgentService,
  library?: LibraryService,
  administration?: AdministrationService,
  catalog?: import("@tuyile/core").ModelCatalogService,
) {
  const app = new Hono<ApiEnv>();
  app.use("*", async (c, next) => {
    c.set("styleNonce", randomUUID());
    await next();
  });
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", (c) => `'nonce-${c.get("styleNonce")}'`],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );
  app.use("/api/*", async (c, next) => {
    c.set("requestId", randomUUID());
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", c.get("requestId"));
    await next();
  });
  app.use("/api/*", async (c, next) =>
    bodyLimit({
      maxSize:
        c.req.path.startsWith("/api/model-admin/") ||
        c.req.path.startsWith("/api/agent/") ||
        /^\/api\/projects\/[^/]+\/canvas/.test(c.req.path)
          ? 1024 * 1024
          : c.req.path === "/api/images/uploads"
            ? 20 * 1024 * 1024
            : c.req.path.startsWith("/api/images/") ||
                c.req.path.startsWith("/api/image-admin/") ||
                c.req.path.startsWith("/api/library/") ||
                c.req.path === "/api/admin/prompts"
              ? 65536
              : 16384,
      onError: (c) =>
        c.json(
          { error: { code: "BODY_TOO_LARGE", requestId: c.get("requestId") } },
          413,
        ),
    })(c, next),
  );
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      if (c.req.header("Origin") !== config.origin)
        throw new AppError("INVALID_ORIGIN", 403);
      const mime = c.req
        .header("Content-Type")
        ?.toLowerCase()
        .split(";")[0]
        .trim();
      if (
        mime !== "application/json" &&
        !(
          c.req.path === "/api/images/uploads" &&
          ["image/png", "image/jpeg", "image/webp"].includes(mime ?? "")
        )
      )
        throw new AppError("JSON_REQUIRED", 415);
    }
    await next();
  });
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/ready", async (c) => {
    try {
      await ready();
    } catch {
      throw new AppError("NOT_READY", 503);
    }
    return c.json({ status: "ready" });
  });
  app.use("/api/auth/*", async (c, next) => {
    if (
      c.req.method === "POST" &&
      ["/api/auth/login", "/api/auth/activate", "/api/auth/reset"].includes(
        c.req.path,
      )
    ) {
      const key = security.digest(`public-auth:${clientAddress(c)}`);
      if (!(await store.transaction((r) => r.consumeLoginBudget(key, 100))))
        throw new AppError("RATE_LIMITED", 429);
    }
    await next();
  });
  app.post("/api/auth/login", async (c) => {
    const input = loginInput.parse(await c.req.json());
    const s = await service.login(input.username, input.password);
    setCookie(c, cookieName, s.token, {
      httpOnly: true,
      secure: config.production,
      sameSite: "Strict",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    return c.json(await service.authenticate(s.token));
  });
  for (const kind of ["activate", "reset"] as const)
    app.post(`/api/auth/${kind}`, async (c) => {
      const input = redeemInput.parse(await c.req.json());
      await service.redeem(input.token, input.password, kind);
      return c.json({ ok: true });
    });
  app.use("/api/*", async (c, next) => {
    const session = await service.authenticate(getCookie(c, cookieName));
    c.set("session", session);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      !equal(c.req.header("X-CSRF-Token") ?? "", session.csrfToken)
    )
      throw new AppError("INVALID_CSRF", 403);
    if (
      session.user.mustChangePassword &&
      !["/api/auth/me", "/api/auth/password", "/api/auth/logout"].includes(
        c.req.path,
      )
    )
      throw new AppError("PASSWORD_CHANGE_REQUIRED", 403);
    await next();
  });
  app.get("/api/auth/me", (c) => c.json(c.get("session")));
  app.post("/api/auth/logout", async (c) => {
    await service.logout(getCookie(c, cookieName)!);
    deleteCookie(c, cookieName, {
      path: "/",
      secure: config.production,
      sameSite: "Strict",
    });
    return c.json({ ok: true });
  });
  app.post("/api/auth/password", async (c) => {
    const input = changePasswordInput.parse(await c.req.json());
    await service.changePassword(
      c.get("session").user,
      input.currentPassword,
      input.password,
    );
    deleteCookie(c, cookieName, { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/projects", async (c) => {
    const projects = await service.projects(
      c.get("session").user,
      pageOffset.parse(c.req.query("offset")),
    );
    return c.json({
      projects: projects.slice(0, 50),
      hasMore: projects.length > 50,
    });
  });
  app.post("/api/projects", async (c) => {
    const input = createProjectInput.parse(await c.req.json());
    return c.json(
      await service.createProject(c.get("session").user, input.name),
      201,
    );
  });
  app.get("/api/projects/:id", async (c) =>
    c.json(
      await service.project(c.get("session").user, id.parse(c.req.param("id"))),
    ),
  );
  app.use("/api/admin/*", async (c, next) => {
    if (c.get("session").user.role !== "admin")
      throw new AppError("FORBIDDEN", 403);
    await next();
  });
  app.get("/api/admin/users", async (c) => {
    const users = await service.users(
      c.get("session").user,
      pageOffset.parse(c.req.query("offset")),
      userSearch.parse(c.req.query("search")),
    );
    return c.json({ users: users.slice(0, 50), hasMore: users.length > 50 });
  });
  app.post("/api/admin/users", async (c) => {
    const input = createUserInput.parse(await c.req.json());
    return c.json(
      await service.createUser(c.get("session").user, input.username),
      201,
    );
  });
  app.post("/api/admin/users/:id/reset", async (c) =>
    c.json(
      await service.reset(c.get("session").user, id.parse(c.req.param("id"))),
    ),
  );
  app.post("/api/admin/users/:id/enabled", async (c) => {
    const input = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    await service.enable(
      c.get("session").user,
      id.parse(c.req.param("id")),
      input.enabled,
    );
    return c.json({ ok: true });
  });
  if (creation) creationRoutes(app, creation);
  if (administration) administrationRoutes(app, administration);
  if (library && creation) libraryRoutes(app, library, creation);
  if (agent) agentRoutes(app, agent);
  if (canvas) canvasRoutes(app, canvas);
  if (catalog) modelCatalogRoutes(app, catalog);
  if (extensions) extensionRoutes(app, extensions);
  app.notFound((c) =>
    c.json(
      { error: { code: "NOT_FOUND", requestId: c.get("requestId") } },
      404,
    ),
  );
  app.onError((error, c) => {
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof z.ZodError
          ? "INVALID_INPUT"
          : error instanceof SyntaxError
            ? "INVALID_JSON"
            : "INTERNAL_ERROR";
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    if (status === 500)
      console.error(JSON.stringify({ code, requestId: c.get("requestId") }));
    return c.json(
      { error: { code, requestId: c.get("requestId") } },
      status as 400,
    );
  });
  return app;
}
