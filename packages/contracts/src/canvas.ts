import { z } from "zod";
const coordinate = z.number().finite().min(-100000).max(100000);
export const canvasNode = z
  .object({
    id: z.uuid(),
    kind: z.enum(["image", "group", "text"]),
    x: coordinate,
    y: coordinate,
    width: z.number().finite().min(40).max(10000),
    height: z.number().finite().min(40).max(10000),
    label: z
      .string()
      .max(100)
      .refine((v) => !v.includes("\0")),
    text: z
      .string()
      .max(4000)
      .refine((v) => !v.includes("\0"))
      .optional(),
    tone: z.enum(["plain", "yellow", "blue", "green"]).optional(),
    assetId: z.uuid().optional(),
    parentId: z.uuid().optional(),
  })
  .strict();
export const canvasDocument = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(canvasNode).max(1000),
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        zoom: z.number().min(0.1).max(4),
      })
      .strict(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
    if (nodes.size !== doc.nodes.length)
      ctx.addIssue({ code: "custom", message: "Duplicate nodes" });
    for (const n of doc.nodes) {
      if (
        (n.kind === "image") !== !!n.assetId ||
        (n.kind === "group" && n.parentId) ||
        (n.kind === "text"
          ? n.text === undefined
          : n.text !== undefined || n.tone !== undefined)
      )
        ctx.addIssue({ code: "custom", message: "Invalid node" });
      if (
        n.parentId &&
        (nodes.get(n.parentId)?.kind !== "group" || n.parentId === n.id)
      )
        ctx.addIssue({ code: "custom", message: "Invalid group" });
    }
  });
export type CanvasDocument = z.infer<typeof canvasDocument>;
export type CanvasNode = z.infer<typeof canvasNode>;
export const emptyCanvas = (): CanvasDocument => ({
  schemaVersion: 1,
  nodes: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
export const canvasSave = z
  .object({
    revision: z.number().int().nonnegative(),
    requestKey: z.uuid(),
    document: canvasDocument,
    placements: z.array(z.uuid()).max(1000),
  })
  .strict();
export type CanvasSave = z.infer<typeof canvasSave>;
export interface CanvasSnapshot {
  document: CanvasDocument;
  revision: number;
}
export interface CanvasOutput {
  outputId: string;
  assetId: string;
  width: number;
  height: number;
  taskId: string;
  sourceIds: string[];
}
export interface CanvasSources {
  textNodeIds?: string[];
  assetId: string;
  sourceIds: string[];
}
