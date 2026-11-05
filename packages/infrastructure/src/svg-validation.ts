import { SaxesParser } from "saxes";
import { AppError } from "@tuyile/core";
const namespace = "http://www.w3.org/2000/svg";
const tags = new Set(
  "svg g defs path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath title desc use".split(
    " ",
  ),
);
const attributes = new Set(
  "id x y x1 y1 x2 y2 cx cy r rx ry width height viewBox preserveAspectRatio d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity transform gradientTransform gradientUnits spreadMethod offset stop-color stop-opacity clip-path clipPathUnits font-family font-size font-weight font-style text-anchor dominant-baseline dx dy href".split(
    " ",
  ),
);
/** Deliberately small static SVG subset. Reject rather than silently change a work. */
export function validateSvg(bytes: Uint8Array) {
  const fail = (): never => {
    throw new AppError("SVG_INVALID_OR_UNSUPPORTED", 422);
  };
  if (!bytes.length || bytes.length > 1024 * 1024) fail();
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail();
  }
  // Do not allow declarations, CDATA, DTD/entities or processing instructions besides an XML header.
  if (
    /<!(?!--)|<\?(?!xml\s)/i.test(xml) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)
  )
    fail();
  type Node = { children: Node[]; refs: string[] };
  const root: Node = { children: [], refs: [] },
    stack: Node[] = [root],
    ids = new Map<string, Node>();
  let nodes = 0,
    width = 0,
    height = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", fail);
  parser.on("doctype", fail);
  parser.on("processinginstruction", fail);
  parser.on("opentag", (tag) => {
    if (
      ++nodes > 10000 ||
      stack.length > 32 ||
      tag.uri !== namespace ||
      !tags.has(tag.local)
    )
      fail();
    const node: Node = { children: [], refs: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
    const values: Record<string, string> = {};
    for (const a of Object.values(tag.attributes)) {
      if (a.uri === "http://www.w3.org/2000/xmlns/") {
        if (![namespace, "http://www.w3.org/1999/xlink"].includes(a.value))
          fail();
        continue;
      }
      if (
        (a.uri &&
          !(a.uri === "http://www.w3.org/1999/xlink" && a.local === "href")) ||
        !attributes.has(a.local) ||
        a.value.length > 200000
      )
        fail();
      const v = a.value;
      values[a.local] = v;
      // No external resources, CSS, escape sequences, functions except transforms/colors and local url(#id).
      if (
        /[\\@<>\u0000-\u001f]/.test(v) ||
        /(?:https?:|file:|data:|javascript:|\/\/)/i.test(v)
      )
        fail();
      if (a.local === "href") {
        if (!/^#[A-Za-z_][\w.-]*$/.test(v)) fail();
        node.refs.push(v.slice(1));
      } else if (/url\s*\(/i.test(v)) {
        if (!/^url\(#[A-Za-z_][\w.-]*\)$/.test(v)) fail();
        node.refs.push(v.slice(5, -1));
      }
      if (a.local === "id") {
        if (!/^[A-Za-z_][\w.-]*$/.test(v) || ids.has(v)) fail();
        ids.set(v, node);
      }
    }
    if (nodes === 1) {
      if (tag.local !== "svg") fail();
      const view = values.viewBox?.trim().split(/[ ,]+/).map(Number);
      const edge = (v?: string) =>
        v && /^\d+(?:\.\d+)?(?:px)?$/.test(v)
          ? Number(v.replace(/px$/, ""))
          : NaN;
      width = edge(values.width);
      height = edge(values.height);
      if (
        view &&
        (view.length !== 4 ||
          view.some((n) => !Number.isFinite(n)) ||
          view[2]! <= 0 ||
          view[3]! <= 0)
      )
        fail();
      if (!values.width && view) width = view[2]!;
      if (!values.height && view) height = view[3]!;
      if (
        ![width, height].every(
          (n) => Number.isInteger(n) && n > 0 && n <= 3840,
        ) ||
        width * height > 8294400
      )
        fail();
    } else if (tag.local === "svg") fail();
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch {
    return fail();
  }
  if (!nodes || stack.length !== 1) fail();
  // Include reference expansion, not just source nodes: reject cycles and exponential use graphs.
  const visiting = new Set<Node>(),
    costs = new Map<Node, number>();
  function cost(n: Node, depth = 0): number {
    if (depth > 64) fail();
    if (visiting.has(n)) fail();
    if (costs.has(n)) return costs.get(n)!;
    visiting.add(n);
    let total = 1;
    for (const child of [
      ...n.children,
      ...n.refs.map((id) => ids.get(id) ?? fail()),
    ]) {
      total += cost(child, depth + 1);
      if (total > 30000) fail();
    }
    visiting.delete(n);
    costs.set(n, total);
    return total;
  }
  cost(root);
  return { width, height };
}
