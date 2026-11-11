import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
const imageDownload = z.object({
  projectId: id,
  assetId: id,
  expires: z
    .string()
    .regex(/^\d{1,12}$/)
    .transform(Number),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

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

  if (creation) {
    app.get("/mcp/download/:projectId/:assetId", async (c) => {
      const requestId = randomUUID();
      c.set("requestId", requestId);
      c.header("X-Request-Id", requestId);
      c.header("Cache-Control", "private, no-store");
      const input = imageDownload.safeParse({
        ...c.req.param(),
        expires: c.req.query("expires"),
        signature: c.req.query("signature"),
      });
      if (!input.success) throw new AppError("NOT_FOUND", 404);
      const { projectId, assetId, expires, signature } = input.data;
      const principal = await tokens.verifyImageDownload(
        projectId,
        assetId,
        expires,
        signature,
      );
      const { asset, bytes } = await creation.bytes(
        principal,
        assetId,
        false,
        true,
      );
      const extension =
        asset.mime === "image/svg+xml" ? "svg" : asset.mime.split("/")[1];
      c.header("Content-Type", asset.mime);
      c.header("X-Content-Type-Options", "nosniff");
      c.header(
        "Content-Disposition",
        `attachment; filename="${asset.id}.${extension}"`,
      );
      return c.body(Buffer.from(bytes));
    });
  }

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
    const projectTool = async (
      projectUrl: string,
      action: (projectId: string, name: string) => Promise<CallToolResult>,
    ): Promise<CallToolResult> => {
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
        return await action(project.id, project.name);
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
    const projectCall = (
      projectUrl: string,
      action: (
        projectId: string,
        name: string,
      ) => Promise<Record<string, unknown>>,
    ) =>
      projectTool(projectUrl, async (projectId, name) => {
        const result = await action(projectId, name);
        return {
          structuredContent: result,
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      });
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
          "Read the saved Tuyile project canvas and its revision. Use read_image with an image node's asset ID to see it. Continue with nextOffset to read additional nodes; check that the revision is consistent across pages.",
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
    if (creation && access.scopes.includes("canvas:read")) {
      const imageInputSchema = { projectUrl: projectLink, assetId: id };
      server.registerTool(
        "read_image",
        {
          description:
            "View a preview of an image on this canvas or a saved output from a task in this project. Use the asset ID from read_canvas or get_image_task.",
          annotations: { readOnlyHint: true, openWorldHint: false },
          inputSchema: imageInputSchema,
        },
        async ({ projectUrl, assetId }) =>
          projectTool(projectUrl, async (projectId) => {
            await tokens.requireImage({ ...access, projectId }, assetId);
            const { asset, bytes } = await creation.bytes(
              access.principal,
              assetId,
              true,
            );
            return {
              // Codex prefers structuredContent over content, so return image content alone.
              content: [
                {
                  type: "image",
                  mimeType: asset.mime,
                  data: Buffer.from(bytes).toString("base64"),
                },
              ],
            };
          }),
      );
      server.registerTool(
        "get_image_download_link",
        {
          description:
            "Create a link to download one original image. Call only if the user explicitly asks for an original download or a link. Use read_image to view it. Anyone with this link can download the original for up to five minutes.",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
          inputSchema: imageInputSchema,
        },
        async ({ projectUrl, assetId }) =>
          projectCall(projectUrl, async (projectId) => {
            const { expires, signature } = await tokens.issueImageDownload(
              { ...access, projectId },
              assetId,
            );
            const url = new URL(
              `/mcp/download/${projectId}/${assetId}`,
              origin,
            );
            url.searchParams.set("expires", String(expires));
            url.searchParams.set("signature", signature);
            return {
              assetId,
              url: url.href,
              expiresAt: new Date(expires * 1000).toISOString(),
            };
          }),
      );
    }
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
            "Read a task in this project by ID. Use read_image with an output's asset ID to see it, or edit_canvas to place it. Do not resubmit for a pending review or an unknown upstream result.",
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
