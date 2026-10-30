import { HeaderUsage } from "./header-usage";
import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
  useBlocker,
} from "react-router-dom";
import {
  Folder,
  Images,
  WandSparkles,
  Star,
  Database,
  ImagePlus,
  Users,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  KeyRound,
  ChevronDown,
} from "lucide-react";
import type { SessionView } from "@tuyile/contracts";
import { Button, Notice, UiProvider, Tooltip, Dropdown } from "@tuyile/ui";
import { client, ApiError, notifySessionChange, sessionTabId } from "./api";
import { SessionProvider, useSessionState } from "./session-state";
import "./styles.css";
const LibraryPage = lazy(() =>
  import("./library").then((m) => ({ default: m.LibraryPage })),
);
const AuthPage = lazy(() =>
  import("./auth").then((m) => ({ default: m.AuthPage })),
);
const ProjectsPage = lazy(() =>
  import("./projects").then((m) => ({ default: m.ProjectsPage })),
);
const ProjectWorkspace = lazy(() =>
  import("./projects").then((m) => ({ default: m.ProjectWorkspace })),
);
const ProjectHeading = lazy(() =>
  import("./projects").then((m) => ({ default: m.ProjectHeading })),
);
const ProjectNavigation = lazy(() =>
  import("./projects").then((m) => ({ default: m.ProjectNavigation })),
);
const UsagePage = lazy(() =>
  import("./creation").then((m) => ({ default: m.UsagePage })),
);
const ImageAdminPage = lazy(() =>
  import("./image-admin").then((m) => ({ default: m.ImageAdminPage })),
);
const AdminPage = lazy(() =>
  import("./accounts").then((m) => ({ default: m.AdminPage })),
);
const PasswordDialog = lazy(() =>
  import("./accounts").then((m) => ({ default: m.PasswordDialog })),
);
const RequiredPasswordPage = lazy(() =>
  import("./auth").then((m) => ({ default: m.RequiredPasswordPage })),
);
function App() {
  const path = useLocation().pathname;
  const [session, setSession] = useState<SessionView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (path === "/login") {
      setSession(null);
      setLoading(false);
      return;
    }
    if (session) return;
    const c = new AbortController();
    setLoading(true);
    void client()<SessionView>("/auth/me", undefined, c.signal)
      .then(setSession)
      .catch((e) => {
        if (c.signal.aborted) return;
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED")
          location.replace("/login");
        else setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [path, session]);
  useEffect(() => {
    function revoked() {
      setSession(null);
      location.replace("/login");
    }
    window.addEventListener("tuyile-unauthenticated", revoked);
    if (typeof BroadcastChannel === "undefined")
      return () =>
        window.removeEventListener("tuyile-unauthenticated", revoked);
    const channel = new BroadcastChannel("tuyile-session");
    channel.onmessage = (e) => {
      if (e.data?.sender !== sessionTabId) {
        setSession(null);
        location.reload();
      }
    };
    return () => {
      channel.close();
      window.removeEventListener("tuyile-unauthenticated", revoked);
    };
  }, []);
  if (path === "/login") return <AuthPage />;
  if (loading)
    return (
      <main className="loading" role="status">
        正在打开你的工作区…
      </main>
    );
  if (!session)
    return (
      <main className="loading">
        <Notice error>{error || "请重新登录。"}</Notice>
        <Link to="/login">前往登录</Link>
      </main>
    );
  if (session.user.mustChangePassword)
    return <RequiredPasswordPage session={session} />;
  return (
    <SessionProvider
      key={`${session.user.id}:${session.user.executionVersion}`}
      session={session}
    >
      <Shell />
    </SessionProvider>
  );
}
function Shell() {
  const state = useSessionState(),
    { session } = state,
    path = useLocation().pathname;
  const accountButton = useRef<React.ComponentRef<typeof Button>>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [collapsed, setCollapsed] = useState(() => {
      try {
        return localStorage.getItem("tuyile.sidebar") === "collapsed";
      } catch {
        return false;
      }
    });
  useEffect(() => setError(""), [path]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && state.dirty(),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let alive = true;
    void state
      .flush()
      .then(() => {
        if (alive) blocker.proceed();
      })
      .catch((e) => {
        if (alive) {
          setError(`未能保存画布，已留在当前项目。${e.message}`);
          blocker.reset();
        }
      });
    return () => {
      alive = false;
    };
  }, [blocker, state]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (state.dirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [state]);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await state.flush();
      await client(session.csrfToken)("/auth/logout", {});
      state.clear();
      notifySessionChange();
      location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const workspace = /^\/projects\/[^/]+$/.test(path);
  const nav = (to: string, label: string, icon: React.ReactNode) => (
    <Tooltip
      title={collapsed ? label : undefined}
      placement="right"
      trigger={["hover", "focus"]}
    >
      <Link
        to={to}
        aria-label={label}
        aria-current={
          path === to || (to === "/projects" && workspace) ? "page" : undefined
        }
      >
        {icon}
        <span>{label}</span>
      </Link>
    </Tooltip>
  );
  return (
    <div
      className={`shell ${collapsed ? "collapsed" : ""} ${workspace ? "workspace-shell" : ""}`}
    >
      <aside className="sidebar" aria-label="主导航">
        <Link className="brand" to="/projects">
          <span className="brand-mark">图</span>
          <span className="full-label brand-copy">
            图一乐<small>Tuyile</small>
          </span>
        </Link>
        <nav>
          {nav("/projects", "项目", <Folder size={20} />)}
          {nav("/gallery", "图库", <Images size={20} />)}
          {nav("/prompts", "提示池", <WandSparkles size={20} />)}
          {nav("/favorites", "收藏", <Star size={20} />)}
          {nav("/usage", "额度", <Database size={20} />)}
          {session.user.role === "admin" && (
            <>
              {nav("/admin/users", "用户管理", <Users size={20} />)}
              {nav("/admin/images", "模型服务", <ImagePlus size={20} />)}
            </>
          )}
        </nav>
        <Suspense fallback={null}>
          <ProjectNavigation />
        </Suspense>
        <div className="sidebar-bottom">
          <Tooltip
            title={collapsed ? "展开导航" : "收起导航"}
            placement="right"
            trigger={["hover", "focus"]}
          >
            <Button
              className="collapse-control"
              aria-label={collapsed ? "展开导航" : "收起导航"}
              aria-expanded={!collapsed}
              onClick={() =>
                setCollapsed((v) => {
                  try {
                    localStorage.setItem(
                      "tuyile.sidebar",
                      v ? "expanded" : "collapsed",
                    );
                  } catch {}
                  return !v;
                })
              }
            >
              {collapsed ? (
                <PanelLeftOpen size={20} />
              ) : (
                <PanelLeftClose size={20} />
              )}
            </Button>
          </Tooltip>
        </div>
      </aside>
      <div className="main-column">
        <header>
          {workspace ? (
            <Suspense fallback={null}>
              <ProjectHeading />
            </Suspense>
          ) : (
            <span>
              {(
                {
                  "/gallery": "图库",
                  "/prompts": "提示池",
                  "/favorites": "收藏",
                  "/usage": "额度",
                  "/admin/users": "用户管理",
                  "/admin/images": "模型服务",
                } as Record<string, string>
              )[path] ?? "项目空间"}
            </span>
          )}
          <div className="actions">
            <HeaderUsage csrfToken={session.csrfToken} />
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              autoFocus
              disabled={busy}
              menu={{
                items: [
                  {
                    key: "password",
                    icon: <KeyRound size={16} />,
                    label: "修改密码",
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogOut size={16} />,
                    label: busy ? "正在退出…" : "退出登录",
                    disabled: busy,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "password") setPasswordOpen(true);
                  if (key === "logout") void logout();
                },
              }}
            >
              <Button
                ref={accountButton}
                type="button"
                className="account-menu-trigger"
                aria-label="账户菜单"
                disabled={busy}
                loading={busy}
              >
                <span className="username" title={session.user.username}>
                  {session.user.username}
                </span>
                <ChevronDown size={14} />
              </Button>
            </Dropdown>
          </div>
        </header>
        <main className="content">
          {error && <Notice error>{error}</Notice>}
          <Suspense fallback={<p role="status">正在加载页面…</p>}>
            <Routes>
              <Route
                path="/gallery"
                element={<LibraryPage key="gallery" mode="gallery" />}
              />
              <Route
                path="/prompts"
                element={<LibraryPage key="prompts" mode="prompts" />}
              />
              <Route
                path="/favorites"
                element={<LibraryPage key="favorites" mode="favorites" />}
              />
              <Route
                path="/projects"
                element={<ProjectsPage csrfToken={session.csrfToken} />}
              />
              <Route
                path="/projects/:projectId"
                element={<ProjectWorkspace csrfToken={session.csrfToken} />}
              />
              <Route
                path="/usage"
                element={<UsagePage csrfToken={session.csrfToken} />}
              />
              <Route
                path="/admin/users"
                element={
                  session.user.role === "admin" ? (
                    <AdminPage
                      csrfToken={session.csrfToken}
                      ownId={session.user.id}
                    />
                  ) : (
                    <Notice error>你没有执行此操作的权限。</Notice>
                  )
                }
              />
              <Route
                path="/admin/images"
                element={
                  session.user.role === "admin" ? (
                    <ImageAdminPage csrfToken={session.csrfToken} />
                  ) : (
                    <Notice error>你没有执行此操作的权限。</Notice>
                  )
                }
              />
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <PasswordDialog
            csrfToken={session.csrfToken}
            open={passwordOpen}
            onClose={() => setPasswordOpen(false)}
            afterClose={() => accountButton.current?.focus()}
          />
        </Suspense>
      </div>
    </div>
  );
}
const router = createBrowserRouter([{ path: "*", element: <App /> }]);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UiProvider>
      <Suspense fallback={<p role="status">正在加载…</p>}>
        <RouterProvider router={router} />
      </Suspense>
    </UiProvider>
  </React.StrictMode>,
);
