import { useInfiniteQuery } from "@tanstack/react-query";
import { useSessionState } from "./session-state";
import { useState, useEffect, useRef, type FormEvent } from "react";
import type {
  UserView,
  UsersPage,
  TemporaryPasswordResult,
} from "@tuyile/contracts";
import {
  useFeedback,
  Button,
  Field,
  Notice,
  useConfirm,
  Table,
  Modal,
  Drawer,
  Dropdown,
  Input,
} from "@tuyile/ui";
import { client, notifySessionChange } from "./api";
import { Ellipsis, Plus, Search } from "lucide-react";
import { UserPolicyEditor } from "./user-policy-editor";
export function AdminPage({
  csrfToken,
  ownId,
}: {
  csrfToken: string;
  ownId: string;
}) {
  const [passwordResult, setPasswordResult] =
    useState<TemporaryPasswordResult | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<UserView | null>(null);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setSearchTerm(search.trim().toLowerCase()),
      250,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const feedback = useFeedback();
  const state = useSessionState();
  const confirm = useConfirm();
  const leaveState = useRef({ dirty, busy: policyBusy || busy });
  leaveState.current = { dirty, busy: policyBusy || busy };
  const leaveConfirm = useRef(confirm);
  leaveConfirm.current = confirm;
  useEffect(
    () =>
      state.registerNavigationGuard({
        isDirty: () => leaveState.current.dirty || leaveState.current.busy,
        canLeave: () =>
          leaveState.current.busy
            ? Promise.resolve(false)
            : leaveConfirm.current("有未保存的用户配置，放弃修改并离开页面？"),
      }),
    [state],
  );
  const api = client(csrfToken);
  const query = useInfiniteQuery({
    queryKey: state.key("admin-users", searchTerm),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<UsersPage>(
        `/admin/users?offset=${pageParam}&search=${encodeURIComponent(searchTerm)}`,
        undefined,
        signal,
      ),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const users = [
      ...new Map(
        (query.data?.pages.flatMap((p) => p.users) ?? []).map((u) => [u.id, u]),
      ).values(),
    ],
    loading = query.isPending,
    hasMore = query.hasNextPage;
  const selectedUser =
    users.find((u) => u.id === selectedId) ??
    (selectedAccount?.id === selectedId ? selectedAccount : undefined);
  async function selectUser(id: string) {
    if (id === selectedId || policyBusy || busy) return;
    if (dirty && !(await confirm("有未保存的用户配置，放弃修改？"))) return;
    setDirty(false);
    setError("");
    setPasswordResult(null);
    setCopied(false);
    setSelectedAccount(users.find((user) => user.id === id) ?? null);
    setSelectedId(id);
  }
  async function action(run: () => Promise<unknown>, successText?: string) {
    setBusy(true);
    setError("");
    setPasswordResult(null);
    setCopied(false);
    try {
      const result = await run();
      if (result && typeof result === "object" && "temporaryPassword" in result)
        setPasswordResult(result as TemporaryPasswordResult);
      await state.queries.invalidateQueries({
        queryKey: state.key("admin-users"),
      });
      feedback.success(
        successText ??
          (result && typeof result === "object" && "temporaryPassword" in result
            ? "临时密码已生成"
            : "已保存"),
      );
    } catch (e) {
      if (createOpen) setError((e as Error).message);
      else feedback.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    try {
      await query.fetchNextPage({ throwOnError: true });
    } catch (e) {
      feedback.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = e.currentTarget;
    void action(async () => {
      const v = await api<TemporaryPasswordResult>("/admin/users", {
        username: new FormData(f).get("username"),
      });
      setCreateOpen(false);
      return v;
    });
  }
  const temporaryResult = passwordResult ? (
    <section className="link-result" aria-label="临时密码交付">
      <h3>{passwordResult.user.username} · 临时密码</h3>
      <Field
        label="临时密码"
        value={passwordResult.temporaryPassword}
        readOnly
        onFocus={(e) => e.target.select()}
      />
      <p className="hint">
        仅展示本次，请复制交给 {passwordResult.user.username}。24
        小时内有效，登录后必须修改。
      </p>
      <div className="actions">
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(passwordResult.temporaryPassword)
              .then(() => setCopied(true))
              .catch(() => setError("自动复制失败，请选中密码手动复制。"));
          }}
        >
          {copied ? "已复制" : "复制临时密码"}
        </Button>
        <Button onClick={() => setPasswordResult(null)}>隐藏密码</Button>
      </div>
    </section>
  ) : null;
  return (
    <section>
      <p className="eyebrow">管理</p>
      <h1>用户管理</h1>
      <div className="users-toolbar">
        <Input
          className="users-search"
          aria-label="搜索用户"
          placeholder="搜索用户名"
          maxLength={64}
          prefix={<Search size={16} />}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            setError("");
            setCreateOpen(true);
          }}
        >
          <Plus size={16} />
          新增用户
        </Button>
      </div>
      <Modal
        title="新增用户"
        open={createOpen}
        width={400}
        footer={null}
        destroyOnHidden
        mask={{ closable: false }}
        keyboard={!busy}
        closable={!busy}
        onCancel={() => {
          setCreateOpen(false);
          setError("");
        }}
      >
        <form aria-label="新增用户" onSubmit={create}>
          <Field
            label="用户名"
            name="username"
            placeholder="3–64 位小写字母、数字或 . _ -"
            required
            pattern="[a-z0-9][a-z0-9_.-]{2,63}"
            minLength={3}
            maxLength={64}
            autoFocus
            disabled={busy}
            autoComplete="off"
          />
          {error && <Notice error>{error}</Notice>}
          <div className="actions users-create-actions">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setCreateOpen(false);
                setError("");
              }}
            >
              取消
            </Button>
            <Button className="primary" disabled={busy} loading={busy}>
              新增用户
            </Button>
          </div>
        </form>
      </Modal>
      {((!createOpen && !selectedUser && error) || query.error) && (
        <Notice error>
          {(!createOpen && !selectedUser && error) || query.error?.message}
        </Notice>
      )}
      {!selectedUser && temporaryResult}
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
              render: (_, u) => (u.role === "admin" ? "管理员" : "用户"),
            },
            {
              title: "状态",
              key: "state",
              render: (_, u) =>
                !u.enabled
                  ? "已停用"
                  : u.mustChangePassword
                    ? "待修改密码"
                    : u.activated
                      ? "已激活"
                      : "待激活/设置密码",
            },
            {
              title: "操作",
              key: "actions",
              render: (_, u) => (
                <div className="actions">
                  <Button type="button" onClick={() => void selectUser(u.id)}>
                    管理
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      <Drawer
        className="user-settings-drawer"
        title={
          selectedUser ? (
            <div className="user-drawer-title">
              <span>{selectedUser.username}</span>
              <span className="user-drawer-meta">
                {selectedUser.role === "admin" ? "管理员" : "用户"} ·{" "}
                {selectedUser.id === ownId
                  ? "当前账号"
                  : !selectedUser.enabled
                    ? "已停用"
                    : selectedUser.mustChangePassword
                      ? "待修改密码"
                      : selectedUser.activated
                        ? "使用中"
                        : "待激活"}
              </span>
            </div>
          ) : (
            "用户配置"
          )
        }
        extra={
          selectedUser && selectedUser.id !== ownId ? (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "reset",
                    label: "重置密码",
                    disabled: busy || policyBusy || !selectedUser.enabled,
                  },
                  {
                    key: "enabled",
                    label: selectedUser.enabled ? "停用账号" : "启用账号",
                    danger: selectedUser.enabled,
                    disabled: busy || policyBusy,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "reset")
                    void (async () => {
                      if (
                        await confirm(
                          `重置 ${selectedUser.username} 的密码？旧密码和旧链接将失效，所有设备退出登录。请将新生成的临时密码交给对方。`,
                        )
                      )
                        await action(() =>
                          api(`/admin/users/${selectedUser.id}/reset`, {}),
                        );
                    })();
                  if (key === "enabled")
                    void (async () => {
                      if (
                        selectedUser.enabled &&
                        !(await confirm(
                          `停用 ${selectedUser.username}？所有设备会退出登录，已确认任务的执行授权也将撤销。`,
                        ))
                      )
                        return;
                      await action(
                        () =>
                          api(`/admin/users/${selectedUser.id}/enabled`, {
                            enabled: !selectedUser.enabled,
                          }),
                        selectedUser.enabled ? "账号已停用" : "账号已启用",
                      );
                    })();
                },
              }}
            >
              <Button
                type="button"
                className="user-account-more"
                aria-label="更多账号操作"
              >
                <Ellipsis size={18} />
              </Button>
            </Dropdown>
          ) : undefined
        }
        open={!!selectedUser}
        size={560}
        onClose={() => void selectUser("")}
        destroyOnHidden
      >
        {selectedUser && (
          <>
            {error && <Notice error>{error}</Notice>}
            {passwordResult?.user.id === selectedId && temporaryResult}
            <UserPolicyEditor
              key={selectedUser.id}
              userId={selectedUser.id}
              csrfToken={csrfToken}
              onDirtyChange={setDirty}
              onBusyChange={setPolicyBusy}
            />
          </>
        )}
      </Drawer>
      {hasMore && (
        <Button disabled={busy} onClick={() => void more()}>
          {busy ? "正在加载…" : "加载更多账号"}
        </Button>
      )}
    </section>
  );
}
export function PasswordDialog({
  csrfToken,
  open,
  onClose,
  afterClose,
}: {
  csrfToken: string;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const state = useSessionState();
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
      await state.flush();
      await client(csrfToken)("/auth/password", {
        currentPassword: f.get("currentPassword"),
        password: f.get("password"),
      });
      state.clear();
      notifySessionChange();
      location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="修改密码"
      open={open}
      width={440}
      centered
      footer={null}
      destroyOnHidden
      mask={{ closable: false }}
      keyboard={!busy}
      closable={!busy}
      onCancel={onClose}
      focusable={{ focusTriggerAfterClose: false }}
      afterClose={() => {
        setError("");
        afterClose();
      }}
    >
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
          disabled={busy}
          autoFocus
        />
        <Field
          label="新密码"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          disabled={busy}
        />
        <Field
          label="确认新密码"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          disabled={busy}
        />
        {error && <Notice error>{error}</Notice>}
        <div className="actions password-dialog-actions">
          <Button type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button className="primary" disabled={busy} loading={busy}>
            {busy ? "正在保存…" : "保存并重新登录"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
