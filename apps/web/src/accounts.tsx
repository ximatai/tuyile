import { useInfiniteQuery } from "@tanstack/react-query";
import { useSessionState } from "./session-state";
import { useState, type FormEvent } from "react";
import type { UserView, LinkResult, UsersPage } from "@tuyile/contracts";
import { Button, Field, Notice, useConfirm, Table } from "@tuyile/ui";
import { client, notifySessionChange } from "./api";
export function AdminPage({
  csrfToken,
  ownId,
}: {
  csrfToken: string;
  ownId: string;
}) {
  const [createVersion, setCreateVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState<LinkResult | null>(null),
    [copied, setCopied] = useState(false);
  const state = useSessionState();
  const confirm = useConfirm();
  const api = client(csrfToken);
  const query = useInfiniteQuery({
    queryKey: state.key("admin-users"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<UsersPage>(`/admin/users?offset=${pageParam}`, undefined, signal),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
    enabled: link?.user.id !== ownId,
  });
  const users = [
      ...new Map(
        (query.data?.pages.flatMap((p) => p.users) ?? []).map((u) => [u.id, u]),
      ).values(),
    ],
    loading = query.isPending,
    hasMore = query.hasNextPage;
  async function action(run: () => Promise<LinkResult | unknown>) {
    setBusy(true);
    setError("");
    setLink(null);
    setCopied(false);
    try {
      const result = await run();
      if (result && typeof result === "object" && "token" in result)
        setLink(result as LinkResult);
      if (
        result &&
        typeof result === "object" &&
        "user" in result &&
        (result as LinkResult).user.id === ownId
      )
        notifySessionChange();
      else {
        await state.queries.invalidateQueries({
          queryKey: state.key("admin-users"),
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    try {
      await query.fetchNextPage({ throwOnError: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    void action(async () => {
      const v = await api<LinkResult>("/admin/users", {
        username: new FormData(f).get("username"),
      });
      setCreateVersion((v) => v + 1);
      return v;
    });
  }
  const url = link ? `${location.origin}/login#${link.kind}=${link.token}` : "";
  return (
    <section>
      <p className="eyebrow">管理</p>
      <h1>账号管理</h1>
      <p className="muted">
        维护账号与访问状态。管理员不能查看其他用户的项目、图片和对话。
      </p>
      <form
        key={createVersion}
        onSubmit={create}
        className="create-project"
        aria-label="创建账号"
      >
        <Field
          label="新账号"
          name="username"
          placeholder="例如：designer01"
          required
          pattern="[a-z0-9][a-z0-9_.-]{2,63}"
          minLength={3}
          maxLength={64}
        />
        <Button className="primary" disabled={busy}>
          {busy ? "正在处理…" : "创建账号"}
        </Button>
      </form>
      <p className="hint">
        3–64 位小写字母、数字或 . _ -；新账号通过链接自行设置密码。
      </p>
      {(error || query.error) && (
        <Notice error>{error || query.error?.message}</Notice>
      )}
      {link && (
        <section className="link-result" aria-label="账号链接">
          {link.user.id === ownId && (
            <Notice>
              当前会话已结束。请保存此链接并打开，设置新密码后重新登录。
            </Notice>
          )}
          <h2>
            {link.kind === "activate" ? "激活链接" : "重置链接"}：
            {link.user.username}
          </h2>
          <p>
            仅展示此次，请通过可信渠道交付。有效期至{" "}
            {new Date(link.expiresAt).toLocaleString("zh-CN")}，使用一次即失效。
          </p>
          <Field
            label="复制交付链接"
            value={url}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <div className="actions">
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setError("自动复制失败，请选中链接手动复制。"));
              }}
            >
              {copied ? "已复制" : "复制链接"}
            </Button>
            <Button onClick={() => setLink(null)}>隐藏链接</Button>
          </div>
        </section>
      )}
      {loading ? (
        <p role="status">正在加载账号…</p>
      ) : (
        <Table<UserView>
          rowKey="id"
          dataSource={users}
          pagination={false}
          scroll={{ x: 620 }}
          columns={[
            { title: "账号", dataIndex: "username", key: "username" },
            {
              title: "角色",
              key: "role",
              render: (_, u) => (u.role === "admin" ? "管理员" : "成员"),
            },
            {
              title: "状态",
              key: "state",
              render: (_, u) =>
                !u.enabled
                  ? "已停用"
                  : u.activated
                    ? "已激活"
                    : "待激活/设置密码",
            },
            {
              title: "操作",
              key: "actions",
              render: (_, u) => (
                <div className="actions">
                  <Button
                    type="button"
                    disabled={busy || !u.enabled}
                    onClick={async () => {
                      if (
                        await confirm(
                          `重新生成 ${u.username} 的链接？旧链接和旧密码将失效，所有设备退出登录；请保存新链接。`,
                        )
                      )
                        void action(() =>
                          api(`/admin/users/${u.id}/reset`, {}),
                        );
                    }}
                  >
                    重新生成链接
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || u.id === ownId}
                    onClick={async () => {
                      if (
                        u.enabled &&
                        !(await confirm(
                          `停用 ${u.username}？所有设备会退出登录，已确认任务的执行授权也将撤销。`,
                        ))
                      )
                        return;
                      void action(() =>
                        api(`/admin/users/${u.id}/enabled`, {
                          enabled: !u.enabled,
                        }),
                      );
                    }}
                  >
                    {u.enabled ? "停用" : "启用"}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {hasMore && (
        <Button disabled={busy} onClick={() => void more()}>
          {busy ? "正在加载…" : "加载更多账号"}
        </Button>
      )}
    </section>
  );
}
export function AccountPage({ csrfToken }: { csrfToken: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (f.get("password") !== f.get("confirm"))
        throw new Error("两次输入的密码不一致。");
      await client(csrfToken)("/auth/password", {
        currentPassword: f.get("currentPassword"),
        password: f.get("password"),
      });
      notifySessionChange();
      location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-page">
      <p className="eyebrow">账户安全</p>
      <h1>修改密码</h1>
      <p className="muted">
        保存后所有设备退出登录，已确认任务的后续执行授权也将撤销；在途请求尽力取消。
      </p>
      <form onSubmit={submit} aria-label="修改密码">
        <Field
          label="当前密码"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
        <Field
          label="新密码"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        <Field
          label="确认新密码"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        {error && <Notice error>{error}</Notice>}
        <Button className="primary" disabled={busy}>
          {busy ? "正在保存…" : "保存并重新登录"}
        </Button>
      </form>
    </section>
  );
}
