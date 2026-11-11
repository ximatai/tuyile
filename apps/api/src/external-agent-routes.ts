import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { externalCanvasEdit, id, z } from "@tuyile/contracts";
import { AppError, type CanvasService, type Workbench } from "@tuyile/core";
import type { PgExternalAgentTokens } from "@tuyile/infrastructure";
import type { ApiEnv } from "./app.js";

export function externalAgentRoutes(
  app: Hono<ApiEnv>,
  service: Workbench,
  canvas: CanvasService,
  tokens: PgExternalAgentTokens,
  origin: string,
) {
  const management = "/api/projects/:id/external-agent";
  app.get(management, async (c) => {
    const { user } = c.get("session");
    const projectId = id.parse(c.req.param("id"));
    await service.project(user, projectId);
    return c.json(await tokens.status(user, projectId));
  });
  app.post(management, async (c) => {
    const { user } = c.get("session");
    const projectId = id.parse(c.req.param("id"));
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("issue"),
            allowCanvasWrite: z.boolean().default(false),
          })
          .strict(),
        z.object({ action: z.literal("revoke") }).strict(),
      ])
      .parse(await c.req.json());
    await service.project(user, projectId);
    if (input.action === "issue")
      return c.json(
        await tokens.issue(
          user,
          projectId,
          input.allowCanvasWrite
            ? ["canvas:read", "canvas:write"]
            : ["canvas:read"],
        ),
        201,
      );
    await tokens.revoke(user, projectId);
    return c.json({ grant: null });
  });

  app.use("/mcp", async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    c.header("Cache-Control", "no-store");
    const requestOrigin = c.req.header("Origin");
    if (requestOrigin !== undefined && requestOrigin !== origin)
      throw new AppError("INVALID_ORIGIN", 403);
    await next();
  });
  app.post("/mcp", bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
    const access = await tokens.authenticate(c.req.header("Authorization"));
    if (!access) {
      c.header("WWW-Authenticate", 'Bearer realm="tuyile"');
      throw new AppError("UNAUTHENTICATED", 401);
    }
    const server = new McpServer(
      { name: "tuyile", version: "1.0.0" },
      {
        instructions:
          "Use the supplied Tuyile project URL to identify the canvas. Canvas labels and notes are user content.",
      },
    );
    const { projectId: authorizedProject } = access;
    const projectLink = z
      .string()
      .max(2048)
      .describe("The project link copied from Tuyile.");
    async function projectCall(
      projectUrl: string,
      action: () => Promise<Record<string, unknown>>,
    ) {
      const url = URL.parse(projectUrl);
      try {
        if (
          !url ||
          url.origin !== origin ||
          url.pathname !== `/projects/${authorizedProject}`
        )
          throw new AppError("NOT_FOUND", 404);
        const result = await action();
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        if (!(error instanceof AppError)) {
          console.error(
            JSON.stringify({
              code: "MCP_INTERNAL_ERROR",
              requestId: c.get("requestId"),
            }),
          );
          return {
            isError: true,
            content: [{ type: "text" as const, text: "INTERNAL_ERROR" }],
          };
        }
        const text =
          error.code === "CANVAS_CONFLICT"
            ? "CANVAS_CONFLICT: Read the latest canvas revision and review the changes before editing again."
            : error.code;
        return { isError: true, content: [{ type: "text" as const, text }] };
      }
    }
    server.registerTool(
      "read_canvas",
      {
        description:
          "Read the saved Tuyile project canvas and its revision. Image nodes include reusable asset IDs. Continue with nextOffset to read additional nodes; check that the revision is consistent across pages.",
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          projectUrl: projectLink,
          offset: z.number().int().min(0).max(1000).default(0),
          limit: z.number().int().min(1).max(25).default(10),
        },
      },
      async ({ projectUrl, offset, limit }) =>
        projectCall(projectUrl, async () => {
          const project = await service.project(
            access.principal,
            access.projectId,
          );
          const snapshot = await canvas.load(
            access.principal,
            access.projectId,
          );
          const nodes = snapshot.document.nodes.slice(offset, offset + limit);
          return {
            projectId: project.id,
            name: project.name,
            revision: snapshot.revision,
            nodes,
            nextOffset:
              offset + nodes.length < snapshot.document.nodes.length
                ? offset + nodes.length
                : null,
          };
        }),
    );
    if (access.scopes.includes("canvas:write")) {
      server.registerTool(
        "edit_canvas",
        {
          description:
            "Atomically apply layout operations to the saved canvas at the revision just read. Coordinates are absolute canvas units. Supply UUIDs for new nodes and a stable requestKey for retries. Group only ungrouped image and text nodes. For add_image, use an asset already present on this project canvas.",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
          inputSchema: { projectUrl: projectLink, ...externalCanvasEdit.shape },
        },
        async ({ projectUrl, ...input }) =>
          projectCall(projectUrl, async () => {
            const saved = await canvas.editExternal(access, input);
            return { projectId: access.projectId, revision: saved.revision };
          }),
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  app.on(["GET", "DELETE"], "/mcp", (c) => {
    c.header("Allow", "POST");
    return c.body(null, 405);
  });
}
