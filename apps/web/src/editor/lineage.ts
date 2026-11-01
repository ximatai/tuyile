import type { Node, Edge } from "@xyflow/react";
/** Presentation only: highlight immediate inputs/outputs, never rewrite the document. */
export function highlightLineage(
  nodes: Node[],
  edges: Edge[],
  selected: string[],
) {
  const seeds = new Set(selected);
  for (const node of nodes)
    if (node.parentId && seeds.has(node.parentId)) seeds.add(node.id);
  const active = edges.filter(
    (edge) => seeds.has(edge.source) || seeds.has(edge.target),
  );
  if (!active.length) return { nodes, edges };
  const related = new Set([
    ...seeds,
    ...active.flatMap((e) => [e.source, e.target]),
  ]);
  // Group frames must stay legible when one of their children is related.
  for (const node of nodes)
    if (related.has(node.id) && node.parentId) related.add(node.parentId);
  const ids = new Set(active.map((edge) => edge.id));
  return {
    nodes: nodes.map((node) => ({
      ...node,
      className: [
        node.className,
        related.has(node.id) ? "lineage-related" : "lineage-muted",
      ]
        .filter(Boolean)
        .join(" "),
    })),
    edges: edges.map((edge) => ({
      ...edge,
      className: ids.has(edge.id) ? "lineage-active" : "lineage-muted",
      style: {
        ...edge.style,
        ...(ids.has(edge.id) ? { stroke: "#0062b0", strokeWidth: 2 } : {}),
      },
    })),
  };
}
