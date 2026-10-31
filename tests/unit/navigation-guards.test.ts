import { expect, it, vi } from "vitest";
import {
  emptyProjectDraft,
  type ProjectDraftDocument,
  type SessionView,
} from "@tuyile/contracts";
import { SessionState } from "../../apps/web/src/session-state";
import { ProjectDraftStore } from "../../apps/web/src/project-draft-store";
import { EditorStore } from "../../apps/web/src/editor/store";
async function seed(
  state: SessionState,
  id: string,
  document: ProjectDraftDocument,
) {
  const store = new ProjectDraftStore(
    async () => ({ revision: 1, document }),
    async (input) => ({
      revision: input.revision + 1,
      document: input.document,
    }),
  );
  await store.load();
  state.projectDrafts.set(id, store);
  return store;
}
const session = {
  user: { id: "test", workspaceId: "workspace", executionVersion: 1 },
  csrfToken: "test",
} as SessionView;
it("includes unsaved form guards in unload checks and allows cancelling navigation", async () => {
  const state = new SessionState(session);
  let dirty = true,
    accept = false;
  const remove = state.registerNavigationGuard({
    isDirty: () => dirty,
    canLeave: async () => accept,
  });
  expect(state.dirty()).toBe(true);
  expect(await state.canLeave()).toBe(false);
  accept = true;
  expect(await state.canLeave()).toBe(true);
  expect(state.dirty()).toBe(true);
  dirty = false;
  expect(state.dirty()).toBe(false);
  dirty = true;
  remove();
  expect(state.dirty()).toBe(false);
  state.clear();
});
it("checks a snapshot of registered guards and clears them when a session ends", async () => {
  const state = new SessionState(session);
  let unexpected = 0;
  const remove = state.registerNavigationGuard({
    isDirty: () => true,
    canLeave: async () => {
      remove();
      state.registerNavigationGuard({
        isDirty: () => true,
        canLeave: async () => {
          unexpected++;
          return false;
        },
      });
      return true;
    },
  });
  expect(await state.canLeave()).toBe(true);
  expect(unexpected).toBe(0);
  state.clear();
  expect(state.dirty()).toBe(false);
  expect(await state.canLeave()).toBe(true);
});

it("shares one confirmation across repeated navigation attempts and retries after cancellation", async () => {
  const state = new SessionState(session);
  let confirmations = 0;
  let finish!: (allowed: boolean) => void;
  const answer = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  state.registerNavigationGuard({
    isDirty: () => true,
    canLeave: () => {
      confirmations++;
      return answer;
    },
  });
  const first = state.canLeave(),
    second = state.canLeave();
  expect(confirmations).toBe(1);
  finish(false);
  expect(await Promise.all([first, second])).toEqual([false, false]);
  expect(await state.canLeave()).toBe(false);
  expect(confirmations).toBe(2);
  state.clear();
});

it("keeps one authoritative draft per project and clears it at session end", async () => {
  const state = new SessionState(session),
    first = emptyProjectDraft(),
    second = emptyProjectDraft();
  first.direct.prompt = "私人草稿";
  first.agent.prompt = "规划草稿";
  second.direct.prompt = "另一个项目";
  await seed(state, "first", first);
  await seed(state, "second", second);
  expect(state.projectDraft("first").get().document.direct.prompt).toBe(
    "私人草稿",
  );
  expect(state.projectDraft("first").get().document.agent.prompt).toBe(
    "规划草稿",
  );
  expect(state.projectDraft("second").get().document.direct.prompt).toBe(
    "另一个项目",
  );
  state.clear();
  expect(state.projectDrafts.size).toBe(0);
});
it("protects current prompt, style and references from the canonical draft", async () => {
  const state = new SessionState(session),
    document = emptyProjectDraft();
  document.direct.prompt = "原需求";
  document.direct.style = { name: "风格", text: "风格正文" };
  document.referenceIds = ["reference"];
  await seed(state, "project", document);
  expect(state.replacesCreativeDraft("project", { prompt: "新需求" })).toBe(
    true,
  );
  expect(state.replacesCreativeDraft("project", { prompt: "原需求" })).toBe(
    false,
  );
  expect(
    state.replacesCreativeDraft("project", { referenceIds: ["reference"] }),
  ).toBe(false);
  expect(state.replacesCreativeDraft("project", { referenceIds: [] })).toBe(
    true,
  );
  expect(state.replacesCreativeDraft("other", { prompt: "新需求" })).toBe(
    false,
  );
  state.clear();
});
it("releases only the deleted project's stores, queued input, subscriptions and query cache", async () => {
  const state = new SessionState(session),
    one = await seed(state, "one", emptyProjectDraft()),
    two = await seed(state, "two", emptyProjectDraft());
  const dispose = vi.fn();
  state.editors.set("one", { dispose } as unknown as EditorStore);
  one.queueTransfer({
    direct: { ...one.get().document.direct, prompt: "queued" },
  });
  const listener = vi.fn();
  one.subscribe(listener);
  state.queries.setQueryData(state.key("canvas", "one"), { private: true });
  state.queries.setQueryData(state.key("canvas-sources", "one", "1"), {});
  state.queries.setQueryData(state.key("canvas", "two"), {});
  state.queries.setQueryData(state.key("usage"), {});
  state.releaseProject("one");
  one.applyQueuedTransfer();
  one.edit({ mode: "agent" });
  expect(dispose).toHaveBeenCalledOnce();
  expect(listener).not.toHaveBeenCalled();
  expect(state.editors.has("one")).toBe(false);
  expect(state.projectDrafts.has("one")).toBe(false);
  expect(state.projectDrafts.get("two")).toBe(two);
  expect(
    state.queries.getQueryData(state.key("canvas", "one")),
  ).toBeUndefined();
  expect(
    state.queries.getQueryData(state.key("canvas-sources", "one", "1")),
  ).toBeUndefined();
  expect(state.queries.getQueryData(state.key("canvas", "two"))).toEqual({});
  expect(state.queries.getQueryData(state.key("usage"))).toEqual({});
  state.clear();
});

it("confirms task replacement when only generation parameters differ", async () => {
  const { emptyProjectDraft } = await import("@tuyile/contracts");
  const { ProjectDraftStore } =
    await import("../../apps/web/src/project-draft-store");
  const state = new SessionState(session),
    document = emptyProjectDraft();
  document.direct.prompt = "same prompt";
  document.direct.settings.modelKey = "model";
  const store = new ProjectDraftStore(
    async () => ({ revision: 1, document }),
    async (input) => ({
      revision: input.revision + 1,
      document: input.document,
    }),
  );
  await store.load();
  state.projectDrafts.set("project", store);
  const task = {
    id: "task",
    projectId: "project",
    requestKey: "request",
    state: "succeeded",
    used: 1,
    held: 0,
    pendingReview: false,
    cancelRequested: false,
    errorCode: null,
    createdAt: "2026-10-31T00:00:00Z",
    outputs: [],
    prompt: "same prompt",
    model: "model",
    count: 1,
    settings: {
      width: 1024,
      height: 1024,
      quality: "medium",
      format: "png",
      referenceIds: [],
    },
  } as import("@tuyile/contracts").ImageTask;
  expect(state.replacesCreativeDraft("project", { task })).toBe(false);
  for (const change of [
    { modelKey: "other" },
    { width: 2048 },
    { height: 2048 },
    { quality: "high" as const },
    { format: "webp" as const },
    { count: 2 },
  ]) {
    store.edit({
      direct: {
        ...document.direct,
        settings: { ...document.direct.settings, ...change },
      },
    });
    expect(
      state.replacesCreativeDraft("project", { task }),
      JSON.stringify(change),
    ).toBe(true);
  }
  store.edit({
    direct: {
      ...document.direct,
      settings: { ...document.direct.settings, modelKey: "historical:task" },
    },
  });
  expect(state.replacesCreativeDraft("project", { task })).toBe(false);
  state.clear();
});
