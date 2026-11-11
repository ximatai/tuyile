import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { id, z } from "@tuyile/contracts";
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
    const { action } = z
      .object({ action: z.enum(["issue", "revoke"]) })
      .strict()
      .parse(await c.req.json());
    await service.project(user, projectId);
    if (action === "issue")
      return c.json(await tokens.issue(user, projectId, ["canvas:read"]), 201);
    await tokens.revoke(user, projectId);
    return c.json({ grant: null });
  });

  app.use("/mcp", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const requestOrigin = c.req.header("Origin");
    if (requestOrigin !== undefined && requestOrigin !== origin)
      throw new AppError("INVALID_ORIGIN", 403);
    await next();
  });
  app.post("/mcp", bodyLimit({ maxSize: 128 * 1024 }), async (c) => {
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
    server.registerTool(
      "read_canvas",
      {
        description:
          "Read the saved Tuyile project canvas and its revision. Image nodes include the reusable asset ID. Continue with nextOffset to read additional nodes.",
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          projectUrl: z
            .string()
            .max(2048)
            .describe("The project link copied from Tuyile."),
          offset: z.number().int().min(0).max(1000).default(0),
        },
      },
      async ({ projectUrl, offset }) => {
        try {
          const url = new URL(projectUrl);
          if (
            url.origin !== origin ||
            url.pathname !== `/projects/${access.projectId}` ||
            !access.scopes.includes("canvas:read")
          )
            throw new AppError("NOT_FOUND", 404);
          const project = await service.project(
            access.principal,
            access.projectId,
          );
          const snapshot = await canvas.load(
            access.principal,
            access.projectId,
          );
          const nodes = snapshot.document.nodes.slice(offset, offset + 25);
          const result = {
            projectId: project.id,
            name: project.name,
            revision: snapshot.revision,
            nodes,
            nextOffset:
              offset + nodes.length < snapshot.document.nodes.length
                ? offset + nodes.length
                : null,
          };
          return {
            structuredContent: result,
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          if (!(error instanceof AppError || error instanceof TypeError))
            throw error;
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof AppError
                    ? error.code
                    : "INVALID_PROJECT_URL",
              },
            ],
          };
        }
      },
    );
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
