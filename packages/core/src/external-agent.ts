import {
  canvasDocument,
  type CanvasDocument,
  type CanvasNode,
  type ExternalCanvasEdit,
  type Principal,
} from "@tuyile/contracts";
import { AppError } from "./index.js";

export interface ExternalAgentAccess {
  principal: Principal;
  projectId: string;
  tokenHash: string;
}

export function applyCanvasOperations(
  document: CanvasDocument,
  operations: ExternalCanvasEdit["operations"],
): CanvasDocument {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  function add(node: CanvasNode) {
    if (nodes.has(node.id)) throw new AppError("CANVAS_NODE_EXISTS", 409);
    nodes.set(node.id, node);
  }
  function get(id: string) {
    const node = nodes.get(id);
    if (!node) throw new AppError("CANVAS_NODE_NOT_FOUND", 404);
    return node;
  }
  for (const operation of operations) {
    switch (operation.action) {
      case "add_image":
        add({ ...operation.node, kind: "image" });
        break;
      case "add_text":
        add({ ...operation.node, kind: "text" });
        break;
      case "move_node": {
        const node = get(operation.nodeId);
        const dx = operation.x - node.x;
        const dy = operation.y - node.y;
        nodes.set(node.id, { ...node, x: operation.x, y: operation.y });
        if (node.kind === "group") {
          for (const child of nodes.values())
            if (child.parentId === node.id)
              nodes.set(child.id, {
                ...child,
                x: child.x + dx,
                y: child.y + dy,
              });
        }
        break;
      }
      case "group_nodes": {
        const members = operation.nodeIds.map(get);
        if (members.some((node) => node.kind === "group" || node.parentId))
          throw new AppError("CANVAS_GROUP_REQUIRES_UNGROUPED_NODES", 409);
        const x = Math.min(...members.map((node) => node.x)) - 25;
        const y = Math.min(...members.map((node) => node.y)) - 40;
        const width =
          Math.max(...members.map((node) => node.x + node.width)) - x + 25;
        const height =
          Math.max(...members.map((node) => node.y + node.height)) - y + 25;
        add({
          id: operation.id,
          kind: "group",
          label: operation.label,
          x,
          y,
          width,
          height,
        });
        for (const member of members)
          nodes.set(member.id, { ...member, parentId: operation.id });
        break;
      }
    }
  }
  const result = canvasDocument.safeParse({
    ...document,
    nodes: [...nodes.values()],
  });
  if (!result.success) throw new AppError("INVALID_CANVAS_LAYOUT", 400);
  return result.data;
}
