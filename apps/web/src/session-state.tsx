import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ImageTask, SessionView } from "@tuyile/contracts";
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
  readonly creationDrafts = new Map<
    string,
    { prompt?: string; referenceIds?: string[]; task?: ImageTask }
  >();
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
