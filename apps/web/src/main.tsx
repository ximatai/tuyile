import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Folder,
  Users,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import type { SessionView } from "@tuyile/contracts";
import { Button, Notice } from "@tuyile/ui";
import { client, ApiError, notifySessionChange, sessionTabId } from "./api";
import { AuthPage } from "./auth";
import { ProjectsPage } from "./projects";
import { AdminPage, AccountPage } from "./accounts";
import "./styles.css";
function App() {
  const [session, setSession] = useState<SessionView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("tuyile.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (location.pathname === "/login") {
      setLoading(false);
      return;
    }
    const c = new AbortController();
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
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("tuyile-session");
    channel.onmessage = (event) => {
      if (event.data?.sender !== sessionTabId) location.reload();
    };
    return () => channel.close();
  }, []);
  if (location.pathname === "/login") return <AuthPage />;
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
        <a href="/login">前往登录</a>
      </main>
    );
  const path = location.pathname;
  const page =
    path === "/admin/users"
      ? "admin"
      : path === "/account"
        ? "account"
        : "projects";
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await client(session!.csrfToken)("/auth/logout", {});
      notifySessionChange();
      location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function toggle() {
    setCollapsed((v) => {
      try {
        localStorage.setItem("tuyile.sidebar", v ? "expanded" : "collapsed");
      } catch {}
      return !v;
    });
  }
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar" aria-label="主导航">
        <a className="brand" href="/projects">
          <span className="brand-mark">图</span>
          <span className="full-label">
            图一乐<small>Tuyile</small>
          </span>
        </a>
        <nav>
          <a
            aria-current={page === "projects" ? "page" : undefined}
            href="/projects"
          >
            <Folder size={20} />
            <span>项目</span>
          </a>
          {session.user.role === "admin" && (
            <a
              aria-current={page === "admin" ? "page" : undefined}
              href="/admin/users"
            >
              <Users size={20} />
              <span>账号管理</span>
            </a>
          )}
          <a
            aria-current={page === "account" ? "page" : undefined}
            href="/account"
          >
            <ShieldCheck size={20} />
            <span>账户安全</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <Button
            className="collapse-control"
            aria-label={collapsed ? "展开导航" : "收起导航"}
            onClick={toggle}
          >
            {collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
            <span className="full-label">收起导航</span>
          </Button>
        </div>
      </aside>
      <div className="main-column">
        <header>
          <span>
            {page === "admin"
              ? "账号管理"
              : page === "account"
                ? "账户安全"
                : "项目空间"}
          </span>
          <div className="actions">
            <span className="username">{session.user.username}</span>
            <Button disabled={busy} onClick={() => void logout()}>
              <LogOut size={16} />
              <span>{busy ? "正在退出…" : "退出登录"}</span>
            </Button>
          </div>
        </header>
        <main className="content">
          {error && <Notice error>{error}</Notice>}
          {page === "admin" ? (
            <AdminPage csrfToken={session.csrfToken} ownId={session.user.id} />
          ) : page === "account" ? (
            <AccountPage csrfToken={session.csrfToken} />
          ) : (
            <ProjectsPage csrfToken={session.csrfToken} />
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
