import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreationStyle, ImageTask, SessionView } from "@tuyile/contracts";
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
  readonly editors = new Map<string, EditorStore>();
  readonly agentDrafts = new Map<
    string,
    { prompt: string; style?: CreationStyle }
  >();
  readonly creativeDrafts = new Map<
    string,
    {
      prompt: string;
      style?: CreationStyle;
      references: { id: string; name: string }[];
    }
  >();
  readonly creationDrafts = new Map<
    string,
    { prompt?: string; referenceIds?: string[]; task?: ImageTask }
  >();
  replacesCreativeDraft(
    projectId: string,
    input: { prompt?: string; referenceIds?: string[]; task?: ImageTask },
  ) {
    const current = this.creativeDrafts.get(projectId);
    if (!current) return false;
    const prompt = input.task?.prompt ?? input.prompt;
    const referenceIds =
      input.task?.settings?.referenceIds ?? input.referenceIds;
    const style = input.task?.settings?.style;
    return !!(
      (current.prompt.trim() &&
        prompt !== undefined &&
        current.prompt !== prompt) ||
      (referenceIds !== undefined &&
        current.references.length &&
        JSON.stringify(current.references.map((r) => r.id)) !==
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
    for (const e of this.editors.values()) await e.flush();
  }
  dirty() {
    return (
      [...this.editors.values()].some((e) => e.get().dirty) ||
      [...this.navigationGuards].some((guard) => guard.isDirty())
    );
  }
  clear() {
    void this.queries.cancelQueries();
    this.queries.clear();
    this.editors.forEach((e) => e.dispose());
    this.editors.clear();
    this.creationDrafts.clear();
    this.creativeDrafts.clear();
    this.agentDrafts.clear();
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
