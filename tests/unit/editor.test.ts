import { it, expect } from "vitest";
import {
  emptyCanvas,
  canvasDocument,
  type CanvasSave,
} from "@tuyile/contracts";
import { EditorStore } from "../../apps/web/src/editor/store.js";
import { randomUUID } from "node:crypto";
const node = () => ({
  id: randomUUID(),
  kind: "image" as const,
  assetId: randomUUID(),
  label: "synthetic",
  x: 0,
  y: 0,
  width: 200,
  height: 200,
});
it("serializes saves without overwriting edits made during an outstanding response", async () => {
  const requests: CanvasSave[] = [];
  let finish!: () => void;
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      requests.push(input);
      if (requests.length === 1) await new Promise<void>((r) => (finish = r));
      return { revision: input.revision + 1, document: input.document };
    },
  );
  store.edit({ ...emptyCanvas(), nodes: [node()] });
  const saving = store.flush();
  store.edit({ ...store.get().document, viewport: { x: 42, y: 0, zoom: 1 } });
  finish();
  await saving;
  expect(requests.map((r) => r.revision)).toEqual([0, 1]);
  expect(store.get().document.viewport.x).toBe(42);
  expect(store.get().dirty).toBe(false);
  store.dispose();
});
it("retries the exact ambiguous save before saving newer edits and retains conflicts", async () => {
  const calls: CanvasSave[] = [];
  let fail = true;
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      calls.push(input);
      if (fail) {
        fail = false;
        throw new Error("network");
      }
      return { revision: input.revision + 1, document: input.document };
    },
  );
  store.edit({ ...emptyCanvas(), nodes: [node()] });
  await expect(store.flush()).rejects.toThrow("network");
  store.edit({ ...store.get().document, viewport: { x: 100, y: 0, zoom: 1 } });
  await store.flush();
  expect(calls[0]).toBe(calls[1]);
  expect(calls[2].revision).toBe(1);
  expect(store.get().dirty).toBe(false);
  store.dispose();
  const conflict = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async () => {
      throw Object.assign(new Error("conflict"), { code: "CANVAS_CONFLICT" });
    },
  );
  conflict.edit({ ...emptyCanvas(), nodes: [node()] });
  await expect(conflict.flush()).rejects.toThrow();
  expect(conflict.get().document.nodes).toHaveLength(1);
  expect(conflict.get().conflict).toBe(true);
  conflict.dispose();
});
it("does not rewind placement receipts when a node is undone or removed", async () => {
  const requests: CanvasSave[] = [];
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      requests.push(input);
      return { revision: input.revision + 1, document: input.document };
    },
  );
  const output = {
    outputId: randomUUID(),
    assetId: randomUUID(),
    taskId: randomUUID(),
    width: 256,
    height: 256,
    sourceIds: [],
  };
  store.place([output]);
  store.undo();
  store.place([output]);
  expect(store.get().document.nodes).toHaveLength(0);
  await store.flush();
  expect(requests[0].placements).toEqual([output.outputId]);
  store.redo();
  expect(store.get().document.nodes).toHaveLength(1);
  store.dispose();
});
it("rejects duplicate nodes and cyclic or missing groups", () => {
  const n = node();
  expect(
    canvasDocument.safeParse({ ...emptyCanvas(), nodes: [n, n] }).success,
  ).toBe(false);
  expect(
    canvasDocument.safeParse({
      ...emptyCanvas(),
      nodes: [{ ...n, parentId: n.id }],
    }).success,
  ).toBe(false);
});
it("allows corrected drafts after a definitive save rejection without replaying the rejected input", async () => {
  const calls: CanvasSave[] = [];
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      calls.push(input);
      if (calls.length === 1)
        throw Object.assign(new Error("reference unavailable"), {
          code: "REFERENCE_UNAVAILABLE",
        });
      return { revision: input.revision + 1, document: input.document };
    },
  );
  store.edit({ ...emptyCanvas(), nodes: [node()] });
  await expect(store.flush()).rejects.toThrow();
  store.edit(emptyCanvas());
  await store.flush();
  expect(calls[1].requestKey).not.toBe(calls[0].requestKey);
  expect(calls[1].document.nodes).toEqual([]);
  expect(store.get().dirty).toBe(false);
  store.dispose();
});

it("copies groups as snapshots, remaps children and pastes as one undoable edit", () => {
  const image = node(),
    group = {
      id: randomUUID(),
      kind: "group" as const,
      label: "group",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    };
  const child = { ...image, parentId: group.id };
  const original = { ...emptyCanvas(), nodes: [group, child] };
  const store = new EditorStore(
    { document: original, revision: 0 },
    async () => {
      throw new Error("not used");
    },
  );
  store.select([group.id]);
  store.copySelection();
  expect(store.get().document).toEqual(original);
  store.edit({ ...original, nodes: [group, { ...child, x: 500 }] });
  store.pasteSelection();
  const [newGroup, newChild] = store.get().document.nodes.slice(2);
  expect(newGroup.id).not.toBe(group.id);
  expect(newChild.parentId).toBe(newGroup.id);
  expect(newChild.assetId).toBe(image.assetId);
  expect(newChild.x).toBe(30);
  expect(store.get().selected).toEqual([newGroup.id, newChild.id]);
  store.undo();
  expect(store.get().document.nodes).toHaveLength(2);
  store.redo();
  expect(store.get().document.nodes).toHaveLength(4);
  store.pasteSelection();
  expect(store.get().document.nodes[5].x).toBe(60);
  store.dispose();
});
it("copies a child without its parent and duplicate preserves the clipboard", () => {
  const a = node(),
    b = { ...node(), x: 200 };
  const store = new EditorStore(
    { document: { ...emptyCanvas(), nodes: [a, b] }, revision: 0 },
    async () => {
      throw new Error("not used");
    },
  );
  store.select([a.id]);
  store.copySelection();
  store.select([b.id]);
  store.duplicateSelection();
  expect(store.get().document.nodes[2].assetId).toBe(b.assetId);
  expect(store.get().selected).toEqual([b.id]);
  store.pasteSelection();
  expect(store.get().document.nodes[3].assetId).toBe(a.assetId);
  store.selectAll();
  expect(store.get().selected).toHaveLength(4);
  store.dispose();
  store.pasteSelection();
  expect(store.get().document.nodes).toHaveLength(4);
});
it("rejects paste limits atomically and isolates clipboards between projects", () => {
  const image = { ...node(), x: 99990 };
  const store = new EditorStore(
    { document: { ...emptyCanvas(), nodes: [image] }, revision: 0 },
    async () => {
      throw new Error("not used");
    },
  );
  store.selectAll();
  store.copySelection();
  expect(() => store.pasteSelection()).toThrow("无法粘贴");
  expect(store.get().document.nodes).toEqual([image]);
  expect(store.get().canUndo).toBe(false);
  const other = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async () => {
      throw new Error("not used");
    },
  );
  other.pasteSelection();
  expect(other.get().document.nodes).toHaveLength(0);
  store.reset({
    document: { ...emptyCanvas(), nodes: Array.from({ length: 1000 }, node) },
    revision: 0,
  });
  store.selectAll();
  store.copySelection();
  expect(() => store.pasteSelection()).toThrow("无法粘贴");
  expect(store.get().document.nodes).toHaveLength(1000);
  store.dispose();
  other.dispose();
});

it("pastes a selected child independently at its absolute canvas position", () => {
  const group = {
    id: randomUUID(),
    kind: "group" as const,
    label: "group",
    x: 100,
    y: 200,
    width: 500,
    height: 500,
  };
  const image = { ...node(), parentId: group.id, x: 150, y: 240 };
  const store = new EditorStore(
    { document: { ...emptyCanvas(), nodes: [group, image] }, revision: 0 },
    async () => {
      throw new Error("not used");
    },
  );
  store.select([image.id]);
  store.copySelection();
  store.pasteSelection();
  const pasted = store.get().document.nodes[2];
  expect(pasted.parentId).toBeUndefined();
  expect(pasted.x).toBe(180);
  expect(pasted.y).toBe(270);
  store.dispose();
});

it("adds uploaded assets in the current viewport, selects once, and keeps undo separate from assets", () => {
  const asset = { id: randomUUID(), width: 800, height: 400 };
  const store = new EditorStore(
    {
      document: { ...emptyCanvas(), viewport: { x: -500, y: -300, zoom: 0.5 } },
      revision: 0,
    },
    async (input) => ({
      document: input.document,
      revision: input.revision + 1,
    }),
  );
  store.addUploadedImage(asset, "uploaded.png");
  const image = store.get().document.nodes[0];
  expect(image).toMatchObject({
    kind: "image",
    assetId: asset.id,
    label: "uploaded.png",
    x: 1120,
    y: 740,
    width: 260,
    height: 130,
  });
  expect(store.get().selected).toEqual([image.id]);
  store.addUploadedImage(asset, "same asset.png");
  expect(store.get().document.nodes).toHaveLength(1);
  store.undo();
  expect(store.get().document.nodes).toHaveLength(0);
  store.redo();
  expect(store.get().document.nodes[0].assetId).toBe(asset.id);
  store.dispose();
});
it("rejects uploaded image insertion before changing a full or conflicting canvas", async () => {
  const store = new EditorStore(
    {
      document: { ...emptyCanvas(), nodes: Array.from({ length: 1000 }, node) },
      revision: 0,
    },
    async () => {
      throw Object.assign(new Error("conflict"), { code: "CANVAS_CONFLICT" });
    },
  );
  expect(() =>
    store.addUploadedImage(
      { id: randomUUID(), width: 1, height: 1 },
      "full.png",
    ),
  ).toThrow("1000");
  expect(store.get().dirty).toBe(false);
  store.reset({ document: emptyCanvas(), revision: 0 });
  store.edit({ ...emptyCanvas(), nodes: [node()] });
  await expect(store.flush()).rejects.toThrow("conflict");
  expect(() => store.canAddImage()).toThrow("保存冲突");
  expect(store.get().document.nodes).toHaveLength(1);
  store.dispose();
});

it("matches clipboard markers only for the latest copied snapshot and preserves them when duplicating", () => {
  const image = node();
  const make = () =>
    new EditorStore(
      { document: { ...emptyCanvas(), nodes: [image] }, revision: 0 },
      async () => {
        throw new Error("not used");
      },
    );
  const store = make(),
    other = make();
  expect(store.matchesCopiedSelection("")).toBe(false);
  store.selectAll();
  store.copySelection();
  const key = store.copiedSelectionKey();
  expect(store.matchesCopiedSelection(key)).toBe(true);
  expect(other.matchesCopiedSelection(key)).toBe(false);
  store.duplicateSelection();
  expect(store.matchesCopiedSelection(key)).toBe(true);
  store.copySelection();
  expect(store.matchesCopiedSelection(key)).toBe(false);
  const latest = store.copiedSelectionKey();
  store.dispose();
  expect(store.matchesCopiedSelection(latest)).toBe(false);
  other.dispose();
});

it("packs varying uploaded images around existing images and groups without moving them", () => {
  const existing = { ...node(), x: 60, y: 70, width: 260, height: 500 };
  const group = {
    id: randomUUID(),
    kind: "group" as const,
    x: 344,
    y: 70,
    width: 260,
    height: 600,
    label: "group",
  };
  const store = new EditorStore(
    { document: { ...emptyCanvas(), nodes: [existing, group] }, revision: 0 },
    async () => {
      throw new Error("not used");
    },
  );
  for (let i = 0; i < 20; i++)
    store.addUploadedImage(
      { id: randomUUID(), width: 400, height: 100 + i * 80 },
      `${i}.png`,
    );
  const nodes = store.get().document.nodes;
  expect(nodes.slice(0, 2)).toEqual([existing, group]);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      expect(
        a.x >= b.x + b.width + 24 ||
          b.x >= a.x + a.width + 24 ||
          a.y >= b.y + b.height + 24 ||
          b.y >= a.y + a.height + 24,
      ).toBe(true);
    }
  store.undo();
  expect(store.get().document.nodes).toHaveLength(21);
  store.dispose();
});
it("checks whole-batch canvas capacity before upload and rejects exhausted coordinate space", () => {
  const store = new EditorStore(
    {
      document: { ...emptyCanvas(), nodes: Array.from({ length: 999 }, node) },
      revision: 0,
    },
    async () => {
      throw new Error("not used");
    },
  );
  expect(() => store.canAddImage(2)).toThrow("1000");
  store.reset({
    document: {
      ...emptyCanvas(),
      viewport: { x: -100000, y: -100000, zoom: 1 },
      nodes: [{ ...node(), x: 99000, y: 99000, width: 10000, height: 10000 }],
    },
    revision: 0,
  });
  expect(() =>
    store.addUploadedImage(
      { id: randomUUID(), width: 100, height: 100 },
      "full.png",
    ),
  ).toThrow("无可排列");
  expect(store.get().document.nodes).toHaveLength(1);
  store.dispose();
});

it("keeps late generated outputs clear of uploaded material and does not acknowledge unplaceable outputs", async () => {
  const requests: CanvasSave[] = [];
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      requests.push(input);
      return { document: input.document, revision: input.revision + 1 };
    },
  );
  store.addUploadedImage(
    { id: randomUUID(), width: 400, height: 200 },
    "upload.png",
  );
  const output = {
    outputId: randomUUID(),
    assetId: randomUUID(),
    taskId: randomUUID(),
    width: 200,
    height: 400,
    sourceIds: [],
  };
  store.place([output]);
  const [a, b] = store.get().document.nodes;
  expect(b.x >= a.x + a.width + 24 || b.y >= a.y + a.height + 24).toBe(true);
  store.reset({
    document: {
      ...emptyCanvas(),
      viewport: { x: -100000, y: -100000, zoom: 1 },
      nodes: [{ ...node(), x: 99000, y: 99000, width: 10000, height: 10000 }],
    },
    revision: 0,
  });
  store.place([output]);
  expect(store.get().dirty).toBe(false);
  store.edit({ ...store.get().document, viewport: { x: 0, y: 0, zoom: 1 } });
  store.place([output]);
  await store.flush();
  expect(requests[0].placements).toEqual([output.outputId]);
  expect(store.get().document.nodes).toHaveLength(2);
  store.dispose();
});

it("includes generated placement receipts when a subscriber immediately saves the new layout", async () => {
  const requests: CanvasSave[] = [];
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      requests.push(input);
      return { document: input.document, revision: input.revision + 1 };
    },
  );
  let saving: Promise<void> | undefined;
  store.subscribe(() => {
    if (store.get().dirty && !store.get().saving) saving = store.flush();
  });
  const output = {
    outputId: randomUUID(),
    assetId: randomUUID(),
    taskId: randomUUID(),
    width: 200,
    height: 200,
    sourceIds: [],
  };
  store.place([output]);
  await saving;
  expect(requests).toHaveLength(1);
  expect(requests[0].placements).toEqual([output.outputId]);
  store.dispose();
});
