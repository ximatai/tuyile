import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  canvasDocument,
  emptyCanvas,
  composeCreativePrompt,
  imageInput,
  projectDraftDocument,
  emptyProjectDraft,
} from "@tuyile/contracts";
import { EditorStore } from "../../apps/web/src/editor/store";
it("persists text, batches an editing session into one undo and copies text without image metadata", async () => {
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => ({
      document: input.document,
      revision: input.revision + 1,
    }),
  );
  const id = store.addText();
  store.renameNode(id, "");
  expect(store.get().document.nodes[0].label).toBe("");
  store.updateText(id, { text: "山间咖啡" });
  store.updateText(id, { text: "山间咖啡\n慢慢相遇。" }, false);
  store.undo();
  expect(store.get().document.nodes[0].text).toBe("");
  store.redo();
  expect(store.get().document.nodes[0].text).toBe("山间咖啡\n慢慢相遇。");
  store.select([id]);
  store.copySelection();
  store.pasteSelection();
  expect(store.get().document.nodes).toHaveLength(2);
  expect(store.get().document.nodes[1]).toMatchObject({
    kind: "text",
    text: "山间咖啡\n慢慢相遇。",
    tone: "yellow",
  });
  expect(store.get().document.nodes[1].id).not.toBe(id);
  const second = store.addText();
  const [a, , b] = store.get().document.nodes;
  expect(b.id).toBe(second);
  expect(
    a.x + a.width <= b.x ||
      a.y + a.height <= b.y ||
      b.x + b.width <= a.x ||
      b.y + b.height <= a.y,
  ).toBe(true);
  await store.flush();
  expect(store.get().dirty).toBe(false);
  store.dispose();
});
it("keeps legacy documents valid and rejects malformed text and reference lists", () => {
  expect(canvasDocument.parse(emptyCanvas())).toEqual(emptyCanvas());
  expect(
    projectDraftDocument.parse(emptyProjectDraft()).textNodeIds,
  ).toBeUndefined();
  const node = {
    id: randomUUID(),
    kind: "text",
    label: "",
    text: "正文",
    tone: "plain",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
  };
  const doc = { ...emptyCanvas(), nodes: [node] };
  expect(canvasDocument.safeParse(doc).success).toBe(true);
  for (const patch of [
    { text: undefined },
    { text: "a".repeat(4001) },
    { text: "\0" },
    { assetId: randomUUID() },
    { kind: "group" },
  ])
    expect(
      canvasDocument.safeParse({ ...doc, nodes: [{ ...node, ...patch }] })
        .success,
    ).toBe(false);
  const ids = [randomUUID()];
  expect(
    projectDraftDocument.safeParse({
      ...emptyProjectDraft(),
      textNodeIds: [...ids, ...ids],
    }).success,
  ).toBe(false);
  expect(
    imageInput.shape.textNodeIds.safeParse(
      Array.from({ length: 9 }, () => randomUUID()),
    ).success,
  ).toBe(false);
});
it("composes ordered snapshots without mutating the creative requirement or interpreting markup", () => {
  const input = {
    prompt: "  设计海报  ",
    style: { name: "插画", text: "平面插画" },
    textSources: [
      { nodeId: randomUUID(), title: "主标题", text: "<b>慢慢相遇</b>" },
      { nodeId: randomUUID(), title: "副标题", text: "一杯拿铁\n山间时光" },
    ],
  };
  expect(composeCreativePrompt(input)).toBe(
    "设计海报\n\n引用文案 1（主标题）：\n<b>慢慢相遇</b>\n\n引用文案 2（副标题）：\n一杯拿铁\n山间时光\n\n画面风格：平面插画",
  );
  expect(input.prompt).toBe("  设计海报  ");
});

it("reuses historical text snapshots as editable prompt content, without live canvas links", async () => {
  const { taskDraftPrompt } =
    await import("../../apps/web/src/task-presentation");
  const task = {
    prompt: "海报",
    textSources: [{ nodeId: randomUUID(), title: "标题", text: "旧版文案" }],
  } as import("@tuyile/contracts").ImageTask;
  expect(taskDraftPrompt(task)).toBe("海报\n\n引用文案 1（标题）：\n旧版文案");
  expect(task.prompt).toBe("海报");
});

it("does not merge text history across an asynchronous image arrival and prunes cancelled edits", () => {
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => ({
      document: input.document,
      revision: input.revision + 1,
    }),
  );
  const id = store.addText();
  store.updateText(id, { text: "draft" });
  store.addUploadedImage(
    { id: randomUUID(), width: 256, height: 256 },
    "arrived",
  );
  store.updateText(id, { text: "final" }, false);
  store.finishTextEdit();
  store.undo();
  expect(store.get().document.nodes).toHaveLength(2);
  expect(store.get().document.nodes[0].text).toBe("draft");
  store.undo();
  expect(store.get().document.nodes).toHaveLength(1);
  expect(store.get().document.nodes[0].text).toBe("draft");
  store.undo();
  expect(store.get().document.nodes[0].text).toBe("");
  store.updateText(id, { text: "cancelled" });
  store.updateText(id, { text: "" }, false);
  store.finishTextEdit();
  store.undo();
  expect(store.get().document.nodes).toHaveLength(0);
  expect(store.get().canUndo).toBe(false);
  store.dispose();
});

it("keeps local edits on a reference version conflict and blocks flush until an explicit reload", async () => {
  let writes = 0;
  const store = new EditorStore(
    { document: emptyCanvas(), revision: 0 },
    async (input) => {
      writes++;
      return { document: input.document, revision: input.revision + 1 };
    },
  );
  const id = store.addText();
  store.updateText(id, { text: "本地未保存内容" });
  store.markReferenceConflict("preview changed");
  await expect(store.flush()).rejects.toThrow("preview changed");
  expect(writes).toBe(0);
  expect(store.get().document.nodes[0].text).toBe("本地未保存内容");
  store.reset({ document: emptyCanvas(), revision: 2 });
  await store.flush();
  expect(store.get().conflict).toBe(false);
  store.dispose();
});
