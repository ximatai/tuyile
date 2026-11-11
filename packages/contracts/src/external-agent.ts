import { z } from "zod";
import { canvasNode } from "./canvas.js";

export const externalAgentScope = z.enum([
  "canvas:read",
  "canvas:write",
  "images:generate",
]);
export type ExternalAgentScope = z.infer<typeof externalAgentScope>;

export interface ExternalAgentGrant {
  expiresAt: string;
  scopes: ExternalAgentScope[];
}
export interface ExternalAgentConnection {
  grant: ExternalAgentGrant | null;
}

export const externalCanvasEdit = z
  .object({
    revision: z.number().int().min(0).max(2147483647),
    requestKey: z.uuid(),
    operations: z
      .array(
        z.discriminatedUnion("action", [
          z
            .object({
              action: z.literal("add_image"),
              node: canvasNode
                .pick({
                  id: true,
                  x: true,
                  y: true,
                  width: true,
                  height: true,
                  label: true,
                })
                .extend({ assetId: z.uuid() }),
            })
            .strict(),
          z
            .object({
              action: z.literal("add_text"),
              node: canvasNode
                .pick({
                  id: true,
                  x: true,
                  y: true,
                  width: true,
                  height: true,
                  label: true,
                  tone: true,
                })
                .extend({ text: canvasNode.shape.text.unwrap() }),
            })
            .strict(),
          z
            .object({
              action: z.literal("move_node"),
              nodeId: z.uuid(),
              ...canvasNode.pick({ x: true, y: true }).shape,
            })
            .strict(),
          z
            .object({
              action: z.literal("group_nodes"),
              id: z.uuid(),
              label: canvasNode.shape.label,
              nodeIds: z
                .array(z.uuid())
                .min(2)
                .max(50)
                .refine((ids) => new Set(ids).size === ids.length),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(25),
  })
  .strict();
export type ExternalCanvasEdit = z.infer<typeof externalCanvasEdit>;

export type ExternalAgentAction =
  | "grant_issued"
  | "grant_revoked"
  | "canvas_edited"
  | "image_submitted"
  | "canvas_undone";

export interface ExternalAgentActivity {
  id: string;
  actor: string;
  action: ExternalAgentAction;
  scopes: ExternalAgentScope[] | null;
  revision: number | null;
  taskId: string | null;
  createdAt: string;
}

export const externalCanvasUndo = z
  .object({
    revision: z.number().int().min(1).max(2147483647),
    requestKey: z.uuid(),
  })
  .strict();
export type ExternalCanvasUndo = z.infer<typeof externalCanvasUndo>;
