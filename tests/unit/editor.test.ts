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
