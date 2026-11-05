import { rasterReferences } from "./raster-reference";
import { taskDraftPrompt } from "./task-presentation";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ImageUsage,
  ImageTask,
  SessionView,
  ProjectDraftDocument,
} from "@tuyile/contracts";
import { ProjectDraftStore } from "./project-draft-store";
import { client } from "./api";
import type { ProjectDraftSnapshot } from "@tuyile/contracts";
import { taskSettings } from "./image-settings";
import { EditorStore } from "./editor/store";
export class SessionState {
  readonly queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 1000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  private readonly navigationGuards = new Set<{
    isDirty: () => boolean;
    canLeave: () => Promise<boolean>;
  }>();
  registerNavigationGuard(guard: {
    isDirty: () => boolean;
    canLeave: () => Promise<boolean>;
  }) {
    this.navigationGuards.add(guard);
    return () => {
      this.navigationGuards.delete(guard);
    };
  }
  private pendingLeave: Promise<boolean> | null = null;
  canLeave(): Promise<boolean> {
    if (!this.pendingLeave) {
      this.pendingLeave = (async () => {
        for (const guard of [...this.navigationGuards])
          if (guard.isDirty() && !(await guard.canLeave())) return false;
        return true;
      })().finally(() => {
        this.pendingLeave = null;
      });
    }
    return this.pendingLeave;
  }
  readonly projectDrafts = new Map<string, ProjectDraftStore>();
  projectDraft(projectId: string) {
    let store = this.projectDrafts.get(projectId);
    if (!store) {
      const api = client(this.session.csrfToken);
      store = new ProjectDraftStore(
        (signal) =>
          api<ProjectDraftSnapshot>(
            `/projects/${projectId}/draft`,
            undefined,
            signal,
          ),
        (input, signal) =>
          api<ProjectDraftSnapshot>(
            `/projects/${projectId}/draft`,
            input,
            signal,
          ),
      );
      this.projectDrafts.set(projectId, store);
    }
    return store;
  }
  async loadProjectDraft(projectId: string) {
    await this.projectDraft(projectId).load();
  }
  readonly editors = new Map<string, EditorStore>();
  async queueDraftTransfer(
    projectId: string,
    input: { prompt?: string; referenceIds?: string[]; task?: ImageTask },
    confirm?: (message: string) => Promise<boolean>,
  ) {
    if (input.referenceIds && confirm) {
      const ids = await rasterReferences(
        this.session.csrfToken,
        input.referenceIds,
        confirm,
      );
      if (!ids) return false;
      input = { ...input, referenceIds: ids };
    }
    const store = this.projectDraft(projectId);
    await store.load();
    const patch: Partial<ProjectDraftDocument> = { mode: "direct" };
    if (input.task) {
      const usage = await client(this.session.csrfToken)<ImageUsage>(
        "/images/usage",
      );
      const settings = taskSettings(input.task, usage);
      if (!settings) throw new Error("这次任务没有可复用的参数。");
      if (
        (input.task.settings?.editSession || input.task.settings?.annotation) &&
        input.task.settings.referenceIds[0]
      ) {
        if (store.get().document.edit?.pendingInput)
          throw new Error("请先继续图片修改，找回原提交结果。");
        patch.edit = {
          baseAssetId: input.task.settings.referenceIds[0],
          prompt: taskDraftPrompt(input.task),
          style: input.task.settings.style,
          preserveRequirements: input.task.settings.preserveRequirements,
          settings: { ...settings, count: 1 },
          textNodeIds: [],
          annotation: input.task.settings.annotation ?? {
            version: 1,
            strokes: [],
          },
        };
      } else {
        patch.direct = {
          prompt: taskDraftPrompt(input.task),
          style: input.task.settings?.style,
          settings,
        };
        patch.referenceIds = input.task.settings!.referenceIds;
        patch.textNodeIds = [];
      }
    }
    if (input.prompt !== undefined)
      patch.direct = {
        ...(patch.direct ?? store.get().document.direct),
        prompt: input.prompt,
      };
    if (input.referenceIds) patch.referenceIds = input.referenceIds;
    store.queueTransfer(
      patch,
      input.referenceIds ? "图库参考图" : input.task ? "任务参考图" : undefined,
    );
    return true;
  }
  releaseProject(projectId: string) {
    this.editors.get(projectId)?.dispose();
    this.editors.delete(projectId);
    this.projectDrafts.get(projectId)?.dispose();
    this.projectDrafts.delete(projectId);
    this.queries.removeQueries({
      predicate: (query) => query.queryKey.slice(3).includes(projectId),
    });
  }
  replacesCreativeDraft(
    projectId: string,
    input: { prompt?: string; referenceIds?: string[]; task?: ImageTask },
  ) {
    const stored = this.projectDrafts.get(projectId)?.get();
    if (!stored?.ready) return false;
    if (input.task?.settings?.editSession || input.task?.settings?.annotation)
      return !!stored.document.edit;
    const current = stored.document.direct;
    const prompt = input.task ? taskDraftPrompt(input.task) : input.prompt;
    const referenceIds =
      input.task?.settings?.referenceIds ?? input.referenceIds;
    const style = input.task?.settings?.style;
    const settings = current.settings;
    const task = input.task;
    const parametersChanged = !!(
      task?.settings &&
      settings &&
      ((settings.modelKey !== (task.settings.modelSelectionId ?? task.model) &&
        !(
          task.settings.modelSelectionId === undefined &&
          settings.modelKey === `historical:${task.id}`
        )) ||
        settings.width !== task.settings.width ||
        settings.height !== task.settings.height ||
        settings.complexity !== task.settings.complexity ||
        settings.quality !== task.settings.quality ||
        settings.format !== task.settings.format ||
        settings.count !== task.count)
    );
    return !!(
      parametersChanged ||
      (!!input.task && !!stored.document.textNodeIds?.length) ||
      (current.prompt.trim() &&
        prompt !== undefined &&
        current.prompt !== prompt) ||
      (referenceIds !== undefined &&
        stored.document.referenceIds.length &&
        JSON.stringify(stored.document.referenceIds) !==
          JSON.stringify(referenceIds)) ||
      (input.task &&
        current.style &&
        (current.style.name !== style?.name ||
          current.style.text !== style?.text))
    );
  }
  constructor(readonly session: SessionView) {}
  key(...parts: string[]) {
    return [
      this.session.user.id,
      this.session.user.workspaceId,
      this.session.user.executionVersion,
      ...parts,
    ];
  }
  async flush() {
    for (const draft of this.projectDrafts.values())
      if (draft.get().dirty) await draft.flush();
    for (const e of this.editors.values()) await e.flush();
  }
  dirty() {
    return (
      [...this.projectDrafts.values()].some((draft) => draft.get().dirty) ||
      [...this.editors.values()].some((e) => e.get().dirty) ||
      [...this.navigationGuards].some((guard) => guard.isDirty())
    );
  }
  clear() {
    void this.queries.cancelQueries();
    this.queries.clear();
    this.editors.forEach((e) => e.dispose());
    this.editors.clear();
    this.projectDrafts.forEach((draft) => draft.dispose());
    this.projectDrafts.clear();
    this.navigationGuards.clear();
  }
}
const Context = createContext<SessionState | null>(null);
export function SessionProvider({
  session,
  children,
}: {
  session: SessionView;
  children: ReactNode;
}) {
  const [state] = useState(() => new SessionState(session));
  useEffect(() => () => state.clear(), [state]);
  return (
    <Context.Provider value={state}>
      <QueryClientProvider client={state.queries}>
        {children}
      </QueryClientProvider>
    </Context.Provider>
  );
}
export function useSessionState() {
  const state = useContext(Context);
  if (!state) throw new Error("Session required");
  return state;
}
