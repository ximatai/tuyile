import { it, expect } from "vitest";
import { highlightLineage } from "../../apps/web/src/editor/lineage";
const nodes: Parameters<typeof highlightLineage>[0] = ["a", "b", "c", "d"].map(
  (id) => ({
    id,
    position: { x: 0, y: 0 },
    data: {},
  }),
);
const edges: Parameters<typeof highlightLineage>[1] = [
  { id: "ac", source: "a", target: "c" },
  { id: "bc", source: "b", target: "c" },
  { id: "cd", source: "c", target: "d" },
];
it("highlights immediate sources and results, with union semantics for multiple selections", () => {
  const fromText = highlightLineage(nodes, edges, ["a"]);
  expect(
    fromText.nodes
      .filter((n) => n.className === "lineage-related")
      .map((n) => n.id),
  ).toEqual(["a", "c"]);
  expect(
    fromText.edges
      .filter((e) => e.className === "lineage-active")
      .map((e) => e.id),
  ).toEqual(["ac"]);
  expect(
    highlightLineage(nodes, edges, ["c"]).nodes.every(
      (n) => n.className === "lineage-related",
    ),
  ).toBe(true);
  expect(
    highlightLineage(nodes, edges, ["a", "b"]).edges.filter(
      (e) => e.className === "lineage-active",
    ),
  ).toHaveLength(2);
  expect(nodes.every((n) => n.className === undefined)).toBe(true);
  expect(edges.every((e) => e.style === undefined)).toBe(true);
});
it("restores normal presentation for empty/unrelated selection and expands selected group children", () => {
  expect(highlightLineage(nodes, edges, []).nodes).toBe(nodes);
  expect(highlightLineage(nodes, edges, ["missing"]).edges).toBe(edges);
  const grouped = [
    { ...nodes[0], parentId: "g" },
    ...nodes.slice(1),
    { id: "g", type: "group", position: { x: 0, y: 0 }, data: {} },
  ];
  const focused = highlightLineage(grouped, edges, ["g"]);
  expect(
    focused.edges
      .filter((e) => e.className === "lineage-active")
      .map((e) => e.id),
  ).toEqual(["ac"]);
  expect(focused.nodes.find((n) => n.id === "g")?.className).toBe(
    "lineage-related",
  );
});
