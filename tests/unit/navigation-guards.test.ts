import { expect, it } from "vitest";
import type { SessionView } from "@tuyile/contracts";
import { SessionState } from "../../apps/web/src/session-state";
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
