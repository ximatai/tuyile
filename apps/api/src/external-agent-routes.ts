import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  externalCanvasEdit,
  externalCanvasUndo,
  id,
  imageInput,
  pageOffset,
  z,
  type ExternalAgentScope,
  type ImageTask,
} from "@tuyile/contracts";
import {
  AppError,
  type CanvasService,
  type CreationService,
  type Workbench,
} from "@tuyile/core";
import type { PgExternalAgentTokens } from "@tuyile/infrastructure";
import type { ApiEnv } from "./app.js";

const grantId = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
const accountGrantChange = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("issue"),
      allowCanvasWrite: z.boolean().default(false),
      allowGeneration: z.boolean().default(false),
      expectedGrantId: grantId,
    })
    .strict(),
  z.object({ action: z.literal("revoke"), expectedGrantId: grantId }).strict(),
]);

export function externalAgentRoutes(
  app: Hono<ApiEnv>,
  service: Workbench,
  canvas: CanvasService,
  tokens: PgExternalAgentTokens,
  origin: string,
  creation?: CreationService,
) {
  const accountManagement = "/api/account/external-agent";
  app.get(accountManagement, async (c) =>
    c.json(await tokens.accountStatus(c.get("session").user)),
  );
  app.post(accountManagement, async (c) => {
    const { user } = c.get("session");
    const input = accountGrantChange.parse(await c.req.json());
    if (input.action === "revoke")
      return c.json(await tokens.revokeAccount(user, input.expectedGrantId));
    return c.json(
      await tokens.issueAccount(user, scopesFor(input), input.expectedGrantId),
      201,
    );
  });

  function scopesFor(input: {
    allowCanvasWrite: boolean;
    allowGeneration: boolean;
  }) {
    const scopes: ExternalAgentScope[] = ["canvas:read"];
    if (input.allowCanvasWrite) scopes.push("canvas:write");
    if (input.allowGeneration && creation) scopes.push("images:generate");
    return scopes;
  }

  const management = "/api/projects/:id/external-agent";
  app.get(management, async (c) => {
    const { user } = c.get("session");
    const projectId = id.parse(c.req.param("id"));
    await service.project(user, projectId);
    return c.json(await tokens.status(user, projectId));
  });
  app.get(`${management}/activity`, async (c) => {
    const { user } = c.get("session");
    const projectId = id.parse(c.req.param("id"));
    await service.project(user, projectId);
    return c.json(
      await tokens.activity(
        user,
        projectId,
        pageOffset.parse(c.req.query("offset")),
      ),
    );
  });
  app.post(`${management}/undo`, async (c) => {
    const { user } = c.get("session");
    const projectId = id.parse(c.req.param("id"));
    return c.json(
      await canvas.undoExternal(
        user,
        projectId,
        externalCanvasUndo.parse(await c.req.json()),
      ),
    );
  });
  app.post(management, async (c) => {
    const { user } = c.get("session");
    const projectId = id.parse(c.req.param("id"));
    const input = z
      .object({ action: z.enum(["issue", "revoke"]) })
      .parse(await c.req.json());
    await service.project(user, projectId);
    if (input.action === "issue")
      throw new AppError("EXTERNAL_AGENT_ACCOUNT_CONNECTION_REQUIRED", 409);
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
    const projectLink = z
      .string()
      .max(2048)
      .describe("The project link copied from Tuyile.");
    const projectCall = async (
      projectUrl: string,
      action: (
        projectId: string,
        name: string,
      ) => Promise<Record<string, unknown>>,
    ) => {
      const url = URL.parse(projectUrl);
      try {
        const projectId = id.safeParse(url?.pathname.split("/")[2]);
        if (
          !url ||
          url.origin !== origin ||
          !projectId.success ||
          url.pathname !== `/projects/${projectId.data}` ||
          (access.legacyProjectId && access.legacyProjectId !== projectId.data)
        )
          throw new AppError("NOT_FOUND", 404);
        const project = await service.project(access.principal, projectId.data);
        const result = await action(project.id, project.name);
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
    };
    if (!access.legacyProjectId)
      server.registerTool(
        "check_connection",
        {
          description:
            "Verify this Tuyile account connection without reading a project.",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
          inputSchema: {},
        },
        async () => {
          if (!access.verified) await tokens.verifyConnection(access.tokenHash);
          return {
            structuredContent: { connected: true },
            content: [
              { type: "text" as const, text: "Tuyile connection verified." },
            ],
          };
        },
      );
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
        projectCall(projectUrl, async (projectId, name) => {
          const snapshot = await canvas.load(access.principal, projectId);
          if (!access.verified) await tokens.verifyConnection(access.tokenHash);
          const nodes = snapshot.document.nodes.slice(offset, offset + limit);
          return {
            projectId,
            name,
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
            "Atomically apply layout operations to the saved canvas at the revision just read. Coordinates are absolute canvas units. Supply UUIDs for new nodes and a stable requestKey for retries. Group only ungrouped image and text nodes. For add_image, use an asset on this canvas or a completed output from a task in this project.",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
          inputSchema: { projectUrl: projectLink, ...externalCanvasEdit.shape },
        },
        async ({ projectUrl, ...input }) =>
          projectCall(projectUrl, async (projectId) => {
            const saved = await canvas.editExternal(
              { ...access, projectId },
              input,
            );
            return { projectId, revision: saved.revision };
          }),
      );
    }
    if (creation && access.scopes.includes("images:generate")) {
      server.registerTool(
        "image_options",
        {
          description:
            "Read the allowed image models, capabilities, image count, and quota before submitting generation in this project.",
          annotations: { readOnlyHint: true, openWorldHint: false },
          inputSchema: { projectUrl: projectLink },
        },
        async ({ projectUrl }) =>
          projectCall(projectUrl, async () => {
            const usage = await creation.usage(access.principal);
            const { maxCount, maxEdge, maxPixels, maxQuality } = usage.policy;
            return {
              models: usage.models,
              modelOptions: usage.modelOptions ?? [],
              capabilities: usage.capabilities,
              limits: {
                maxCount,
                maxEdge,
                maxPixels,
                maxQuality,
                remainingImages: usage.available,
              },
            };
          }),
      );
      const generationInput = imageInput.omit({
        projectId: true,
        annotation: true,
        editSession: true,
      });
      server.registerTool(
        "submit_image_task",
        {
          description:
            "Queue image generation or reference-image editing requested by the user. This consumes the user's image allowance for successful outputs. Reuse requestKey if the response is lost. References must be on this project canvas or be project task outputs. Poll get_image_task for completed assets and use edit_canvas to place them.",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: { projectUrl: projectLink, ...generationInput.shape },
        },
        async ({ projectUrl, ...input }) =>
          projectCall(projectUrl, async (projectId) =>
            imageTaskStatus(
              await creation.submitExternal(
                { ...access, projectId },
                generationInput.parse(input),
              ),
            ),
          ),
      );
      server.registerTool(
        "get_image_task",
        {
          description:
            "Read a task in this project by ID. Use the asset IDs of successful outputs to place them on the canvas. Do not resubmit for a pending review or an unknown upstream result.",
          annotations: { readOnlyHint: true, openWorldHint: false },
          inputSchema: { projectUrl: projectLink, taskId: id },
        },
        async ({ projectUrl, taskId }) =>
          projectCall(projectUrl, async (projectId) =>
            imageTaskStatus(
              await creation.task(access.principal, taskId, projectId),
            ),
          ),
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

function imageTaskStatus(task: ImageTask) {
  return {
    projectId: task.projectId,
    taskId: task.id,
    state: task.state,
    pendingReview: task.pendingReview,
    errorCode: task.errorCode,
    used: task.used,
    held: task.held,
    outputs: task.outputs
      .filter((asset) => !asset.deleted)
      .map((asset) => ({
        assetId: asset.id,
        width: asset.width,
        height: asset.height,
        mime: asset.mime,
      })),
  };
}
