import { useState, useEffect, type FormEvent } from "react";
import { Button, Field, Notice } from "@tuyile/ui";
import { client, notifySessionChange } from "./api";
export function AuthPage() {
  const [link] = useState(() => {
    const match = location.hash.match(/^#(activate|reset)=([a-f0-9]{64})$/);
    return match ? { kind: match[1], token: match[2] } : null;
  });
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
    // A new link pasted into this same /login tab is a new authentication flow.
    // Reload to discard old form state and in-flight callbacks before reading it.
    const changed = () => location.reload();
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (link && !done) {
        if (f.get("password") !== f.get("confirm"))
          throw new Error("两次输入的密码不一致。");
        await client()(`/auth/${link.kind}`, {
          token: link.token,
          password: f.get("password"),
        });
        notifySessionChange();
        setDone(true);
      } else {
        await client()("/auth/login", {
          username: f.get("username"),
          password: f.get("password"),
        });
        notifySessionChange();
        location.assign("/projects");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const redeem = !!link && !done;
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">图</span>
        <strong>
          图一乐 <small>Tuyile</small>
        </strong>
      </div>
      <section className="auth-form">
        <p className="eyebrow">你的图片创作空间</p>
        <h1>
          {redeem
            ? link.kind === "activate"
              ? "激活账号"
              : "重置密码"
            : "登录图一乐"}
        </h1>
        <p className="muted">
          {redeem
            ? "设置密码后，使用管理员提供的账号登录。"
            : "使用管理员为你创建的账号继续。"}
        </p>
        {done && <Notice>密码已设置，请登录。</Notice>}
        <form
          key={redeem ? "redeem" : "login"}
          onSubmit={submit}
          aria-label={redeem ? "设置密码" : "登录"}
        >
          {!redeem && (
            <Field
              label="账号"
              name="username"
              autoComplete="username"
              required
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
          <Field
            label={redeem ? "新密码" : "密码"}
            name="password"
            type="password"
            autoComplete={redeem ? "new-password" : "current-password"}
            required
            minLength={redeem ? 12 : 1}
            maxLength={128}
          />
          {redeem && (
            <>
              <Field
                label="确认新密码"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <p className="hint">密码为 12–128 个字符。</p>
            </>
          )}
          {error && <Notice error>{error}</Notice>}
          <Button className="primary" disabled={busy}>
            {busy ? "正在处理…" : redeem ? "保存密码" : "登录"}
          </Button>
        </form>
        <p className="hint">
          {redeem ? (
            <a href="/login">返回登录</a>
          ) : (
            "账号激活或忘记密码，请联系管理员。"
          )}
        </p>
      </section>
      <footer>私人项目 · 独立创作</footer>
    </main>
  );
}

export function RequiredPasswordPage({
  session,
}: {
  session: import("@tuyile/contracts").SessionView;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (data.get("password") !== data.get("confirm")) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await client(session.csrfToken)("/auth/password", {
        currentPassword: data.get("currentPassword"),
        password: data.get("password"),
      });
      notifySessionChange();
      location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-form">
        <h1>设置自己的密码</h1>
        <p className="muted">
          {session.user.username}，你正在使用临时密码，请修改后继续。
        </p>
        <form aria-label="设置自己的密码" onSubmit={submit}>
          <Field
            label="临时密码"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={busy}
          />
          <Field
            label="新密码"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
          <Field
            label="确认新密码"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
          <p className="hint">密码为 12–128 个字符，不能与临时密码相同。</p>
          {error && <Notice error>{error}</Notice>}
          <Button className="primary" disabled={busy}>
            保存并重新登录
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void client(session.csrfToken)("/auth/logout", {})
                .then(() => {
                  notifySessionChange();
                  location.assign("/login");
                })
                .catch((e) => {
                  setError(e.message);
                  setBusy(false);
                });
            }}
          >
            退出登录
          </Button>
        </form>
      </section>
    </main>
  );
}
