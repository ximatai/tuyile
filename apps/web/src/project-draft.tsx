import {
  createContext,
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Button, Notice, useConfirm } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import type { ProjectDraftDocument } from "@tuyile/contracts";
import type { ProjectDraftStore } from "./project-draft-store";
const Context = createContext<ProjectDraftStore | null>(null);
export function useProjectDraft() {
  const store = useContext(Context);
  if (!store) throw new Error("Project draft required");
  return store;
}
export function useDraftValue<
  S extends "direct" | "agent",
  K extends keyof ProjectDraftDocument[S],
>(
  section: S,
  key: K,
): [
  ProjectDraftDocument[S][K],
  Dispatch<SetStateAction<ProjectDraftDocument[S][K]>>,
] {
  const store = useProjectDraft(),
    doc = useSyncExternalStore(store.subscribe, () => store.get().document);
  const setValue = useCallback(
    (action: SetStateAction<ProjectDraftDocument[S][K]>) => {
      const previous = store.get().document[section];
      const value =
        typeof action === "function"
          ? (
              action as (
                old: ProjectDraftDocument[S][K],
              ) => ProjectDraftDocument[S][K]
            )(previous[key])
          : action;
      store.edit({ [section]: { ...previous, [key]: value } });
    },
    [store, section, key],
  );
  return [doc[section][key], setValue];
}
export function useDraftMode(): [
  ProjectDraftDocument["mode"],
  Dispatch<SetStateAction<ProjectDraftDocument["mode"]>>,
] {
  const store = useProjectDraft(),
    doc = useSyncExternalStore(store.subscribe, () => store.get().document);
  const setMode = useCallback(
    (action: SetStateAction<ProjectDraftDocument["mode"]>) => {
      store.edit({
        mode:
          typeof action === "function"
            ? action(store.get().document.mode)
            : action,
      });
    },
    [store],
  );
  return [doc.mode, setMode];
}
export function useDraftReferences(): [
  { id: string; name: string }[],
  Dispatch<SetStateAction<{ id: string; name: string }[]>>,
] {
  const store = useProjectDraft(),
    snapshot = useSyncExternalStore(store.subscribe, store.get);
  const refs = useMemo(
    () =>
      snapshot.document.referenceIds.map((id) => ({
        id,
        name: store.referenceName(id),
      })),
    [store, snapshot],
  );
  const setRefs = useCallback(
    (action: SetStateAction<{ id: string; name: string }[]>) =>
      store.editReferences(action),
    [store],
  );
  return [refs, setRefs];
}
export function ProjectDraftBoundary({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const state = useSessionState(),
    store = state.projectDraft(projectId),
    snapshot = useSyncExternalStore(store.subscribe, store.get),
    confirm = useConfirm();
  useEffect(() => {
    void store
      .load()
      .then(() => store.applyQueuedTransfer())
      .catch(() => {});
  }, [store]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden")
        void store.flush().catch(() => {});
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [store]);
  async function resolve(overwrite: boolean) {
    if (
      !(await confirm(
        overwrite
          ? "用当前输入覆盖服务器上的草稿？"
          : "加载服务器草稿？当前未保存的输入将被替换。",
      ))
    )
      return;
    try {
      if (overwrite) await store.overwrite();
      else await store.reload();
    } catch {
      /* Store errors remain visible. */
    }
  }
  return (
    <Context.Provider value={store}>
      {snapshot.error && (
        <Notice error>
          <span>
            草稿{snapshot.ready ? "未保存" : "加载失败"}：{snapshot.error}
          </span>
          <div className="actions">
            {snapshot.conflict ? (
              <>
                <Button type="button" onClick={() => void resolve(false)}>
                  加载最新草稿
                </Button>
                <Button type="button" onClick={() => void resolve(true)}>
                  保留当前版本
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={snapshot.saving}
                onClick={() =>
                  void (
                    snapshot.ready
                      ? store.flush()
                      : store.load().then(() => store.applyQueuedTransfer())
                  ).catch(() => {})
                }
              >
                重试
              </Button>
            )}
          </div>
        </Notice>
      )}
      {snapshot.ready ? (
        <DraftEpoch key={snapshot.epoch}>{children}</DraftEpoch>
      ) : !snapshot.error ? (
        <p role="status">正在恢复创作草稿…</p>
      ) : null}
    </Context.Provider>
  );
}
function DraftEpoch({ children }: { children: React.ReactNode }) {
  return children;
}
