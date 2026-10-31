import { afterEach, expect, it, vi } from "vitest";
import {
  emptyProjectDraft,
  type ProjectDraftSave,
  type ProjectDraftSnapshot,
} from "@tuyile/contracts";
import { ProjectDraftStore } from "../../apps/web/src/project-draft-store";
const stores: ProjectDraftStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
});
function fixture(
  write?: (input: ProjectDraftSave) => Promise<ProjectDraftSnapshot>,
) {
  let remote: ProjectDraftSnapshot = {
    revision: 0,
    document: emptyProjectDraft(),
  };
  const writes: ProjectDraftSave[] = [];
  const store = new ProjectDraftStore(
    async () => structuredClone(remote),
    async (input) => {
      writes.push(structuredClone(input));
      if (write) return write(input);
      remote = {
        revision: input.revision + 1,
        document: structuredClone(input.document),
      };
      return remote;
    },
  );
  stores.push(store);
  return {
    store,
    writes,
    setRemote: (value: ProjectDraftSnapshot) => {
      remote = value;
    },
  };
}
it("debounces edits and serializes changes made during an outstanding save", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const { store, writes } = fixture(async (input) => {
    if (input.revision === 0) await new Promise<void>((r) => (release = r));
    return { revision: input.revision + 1, document: input.document };
  });
  await store.load();
  store.edit({ direct: { ...store.get().document.direct, prompt: "first" } });
  const save = store.flush();
  await vi.advanceTimersByTimeAsync(0);
  store.edit({ direct: { ...store.get().document.direct, prompt: "second" } });
  release();
  await save;
  expect(writes.map((w) => [w.revision, w.document.direct.prompt])).toEqual([
    [0, "first"],
    [1, "second"],
  ]);
  expect(store.get().dirty).toBe(false);
  store.edit({ direct: { ...store.get().document.direct, prompt: "third" } });
  await vi.advanceTimersByTimeAsync(999);
  expect(writes).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(writes).toHaveLength(3);
});
it("retries an ambiguous save with the original key before saving newer edits", async () => {
  let attempts = 0;
  const { store, writes } = fixture(async (input) => {
    if (++attempts === 1) throw new Error("network");
    return { revision: input.revision + 1, document: input.document };
  });
  await store.load();
  store.edit({
    direct: { ...store.get().document.direct, prompt: "original" },
  });
  await expect(store.flush()).rejects.toThrow("network");
  store.edit({ direct: { ...store.get().document.direct, prompt: "" } });
  expect(store.get().dirty).toBe(true);
  await store.flush();
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[2].document.direct.prompt).toBe("");
  expect(store.get().dirty).toBe(false);
});
it("preserves local text on conflict until explicitly reloaded or overwritten", async () => {
  const { store, setRemote } = fixture(async (input) => {
    if (input.revision === 0)
      throw Object.assign(new Error("conflict"), { code: "DRAFT_CONFLICT" });
    return { revision: input.revision + 1, document: input.document };
  });
  await store.load();
  store.edit({ direct: { ...store.get().document.direct, prompt: "local" } });
  await expect(store.flush()).rejects.toThrow();
  expect(store.get().document.direct.prompt).toBe("local");
  expect(store.get().conflict).toBe(true);
  setRemote({
    revision: 2,
    document: {
      ...emptyProjectDraft(),
      direct: { ...emptyProjectDraft().direct, prompt: "remote" },
    },
  });
  await store.overwrite();
  expect(store.get().revision).toBe(3);
  expect(store.get().document.direct.prompt).toBe("local");
  await store.reload();
  expect(store.get().document.direct.prompt).toBe("remote");
  expect(store.get().epoch).toBe(2);
});
it("does not write before loading and ignores responses after session disposal", async () => {
  let resolve!: (s: ProjectDraftSnapshot) => void;
  const store = new ProjectDraftStore(
    () => new Promise((r) => (resolve = r)),
    async () => {
      throw new Error("must not write");
    },
  );
  stores.push(store);
  store.edit({ mode: "agent" });
  const loading = store.load();
  store.dispose();
  resolve({ revision: 1, document: emptyProjectDraft() });
  await loading;
  expect(store.get().ready).toBe(false);
  expect(store.get().document.mode).toBe("direct");
});

it("does not repeatedly save equivalent server documents with reordered object keys", async () => {
  const { store, writes } = fixture(async (input) => ({
    revision: input.revision + 1,
    document: {
      ...input.document,
      agent: {
        prompt: input.document.agent.prompt,
        settings: input.document.agent.settings,
        conversationModel: "",
        skillId: "",
      },
    },
  }));
  await store.load();
  store.edit({
    agent: {
      skillId: "",
      conversationModel: "",
      settings: store.get().document.agent.settings,
      prompt: "reordered",
    },
  });
  await store.flush();
  expect(writes).toHaveLength(1);
  expect(store.get().dirty).toBe(false);
});

it("keeps edits made while a confirmed reload is waiting and allows a fresh reload afterwards", async () => {
  let reads = 0,
    finish!: (snapshot: ProjectDraftSnapshot) => void;
  const remote = {
    revision: 3,
    document: {
      ...emptyProjectDraft(),
      direct: { ...emptyProjectDraft().direct, prompt: "remote" },
    },
  };
  const store = new ProjectDraftStore(
    async () =>
      ++reads === 2 ? new Promise((resolve) => (finish = resolve)) : remote,
    async () => {
      throw Object.assign(new Error("conflict"), { code: "DRAFT_CONFLICT" });
    },
  );
  stores.push(store);
  await store.load();
  store.edit({
    direct: { ...store.get().document.direct, prompt: "before reload" },
  });
  await store.flush().catch(() => {});
  const reloading = store.reload();
  await Promise.resolve();
  await Promise.resolve();
  store.edit({
    direct: {
      ...store.get().document.direct,
      prompt: "typed after confirmation",
    },
  });
  finish(remote);
  await reloading;
  expect(store.get()).toMatchObject({
    dirty: true,
    conflict: true,
    epoch: 1,
    document: { direct: { prompt: "typed after confirmation" } },
  });
  expect(store.get().error).toContain("当前输入已保留");
  await store.reload();
  expect(store.get()).toMatchObject({
    dirty: false,
    conflict: false,
    epoch: 2,
    document: { direct: { prompt: "remote" } },
  });
});
it("ignores an older reload response after a newer overwrite has saved the local version", async () => {
  let reads = 0,
    finish!: (snapshot: ProjectDraftSnapshot) => void;
  const store = new ProjectDraftStore(
    async () =>
      ++reads === 2
        ? new Promise((resolve) => (finish = resolve))
        : { revision: 4, document: emptyProjectDraft() },
    async (input) => ({
      revision: input.revision + 1,
      document: input.document,
    }),
  );
  stores.push(store);
  await store.load();
  store.edit({
    direct: { ...store.get().document.direct, prompt: "keep local" },
  });
  const reloading = store.reload();
  await Promise.resolve();
  await Promise.resolve();
  await store.overwrite();
  finish({ revision: 1, document: emptyProjectDraft() });
  await reloading;
  expect(store.get()).toMatchObject({
    revision: 5,
    dirty: false,
    document: { direct: { prompt: "keep local" } },
  });
});

it("stages cross-page selection without making an offscreen draft dirty, then consumes it exactly once", async () => {
  const { store, writes } = fixture();
  await store.load();
  store.queueTransfer(
    {
      direct: { ...store.get().document.direct, prompt: "selected" },
      referenceIds: ["reference"],
      mode: "direct",
    },
    "图库参考图",
  );
  expect(store.get().dirty).toBe(false);
  expect(store.get().document.direct.prompt).toBe("");
  store.applyQueuedTransfer();
  expect(store.get().document.direct.prompt).toBe("selected");
  expect(store.referenceName("reference")).toBe("图库参考图");
  store.edit({
    direct: { ...store.get().document.direct, prompt: "further edit" },
  });
  store.applyQueuedTransfer();
  expect(store.get().document.direct.prompt).toBe("further edit");
  await store.flush();
  expect(writes).toHaveLength(1);
});
it("updates reference presentation labels independently of the canonical reference IDs", async () => {
  const { store } = fixture();
  await store.load();
  store.editReferences([{ id: "reference", name: "uploaded.png" }]);
  await store.flush();
  store.editReferences((old) =>
    old.map((ref) => ({ ...ref, name: "任务参考图" })),
  );
  expect(store.get().document.referenceIds).toEqual(["reference"]);
  expect(store.referenceName("reference")).toBe("任务参考图");
  expect(store.get().dirty).toBe(false);
});
