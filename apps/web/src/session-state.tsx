import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SessionView } from "@tuyile/contracts";
import { EditorStore } from "./editor/store";
export class SessionState {
  readonly queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 1000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  readonly editors = new Map<string, EditorStore>();
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
    return [...this.editors.values()].some((e) => e.get().dirty);
  }
  clear() {
    void this.queries.cancelQueries();
    this.queries.clear();
    this.editors.forEach((e) => e.dispose());
    this.editors.clear();
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
