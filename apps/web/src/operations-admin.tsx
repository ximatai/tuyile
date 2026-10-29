import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  AdminSummary,
  ExecutionSettings,
  PlanningPolicy,
  UsersPage,
} from "@tuyile/contracts";
import { Button, ChoiceField, Field, Notice, Table } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
export function OperationsAdmin() {
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    [selected, setSelected] = useState("");
  const summary = useQuery({
    queryKey: state.key("admin-summary"),
    queryFn: ({ signal }) =>
      api<AdminSummary>("/image-admin/summary", undefined, signal),
    refetchInterval: 5000,
  });
  const settings = useQuery({
    queryKey: state.key("execution-settings"),
    queryFn: ({ signal }) =>
      api<ExecutionSettings>(
        "/image-admin/execution-settings",
        undefined,
        signal,
      ),
  });
  const users = useInfiniteQuery({
    queryKey: state.key("admin-users"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<UsersPage>(`/admin/users?offset=${pageParam}`, undefined, signal),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const allUsers = users.data?.pages.flatMap((p) => p.users) ?? [],
    user = selected || allUsers[0]?.id || "";
  const data = summary.data,
    differences = data
      ? Object.values(data.reconciliation).reduce((n, v) => n + v, 0)
      : 0;
  return (
    <section className="settings-section operations-admin">
      <h2>运行概览与规划策略</h2>
      <p className="hint">
        只展示状态、用量和管理元数据，不包含用户图片、提示词或服务密钥。
      </p>
      {(summary.error || settings.error || users.error) && (
        <Notice error>
          {summary.error?.message ||
            settings.error?.message ||
            users.error?.message}
        </Notice>
      )}
      {data && (
        <>
          <div className="operations-metrics">
            <div>
              <span>今日成功图片</span>
              <strong>{data.today.imagesUsed}</strong>
              <small>预留 {data.today.imagesHeld} 张</small>
            </div>
            <div>
              <span>今日规划已用</span>
              <strong>{data.today.planningUsed}</strong>
              <small>预留 {data.today.planningHeld} 次</small>
            </div>
            <div>
              <span>今日上游图片尝试</span>
              <strong>{data.today.imageAttempts}</strong>
              <small>规划调用 {data.today.planningCalls} 次</small>
            </div>
            <div>
              <span>待核验任务</span>
              <strong>{data.pendingReview}</strong>
              <small>
                存储已用 {(data.storage.used / 1048576).toFixed(1)} MiB
              </small>
            </div>
          </div>
          <p className="hint">
            图片排队 {data.imageStates.queued ?? 0} · 执行中{" "}
            {data.imageStates.running ?? 0}；规划排队{" "}
            {data.planningStates.queued ?? 0} · 执行中{" "}
            {data.planningStates.running ?? 0}。规划调用用量缺失{" "}
            {data.today.unknownPlanningUsage} 次，记为 unknown。
          </p>
          <Notice error={differences > 0}>
            {differences
              ? `对账发现 ${differences} 条差异，请核对流水与输出证据。`
              : "图片统计日、逐单预留和规划计次对账一致。"}
          </Notice>
          <h3>近期错误</h3>
          <Table
            rowKey={(row) => `${row.kind}-${row.id}`}
            dataSource={data.errors}
            pagination={{ pageSize: 5 }}
            columns={[
              {
                title: "时间",
                dataIndex: "createdAt",
                render: (v: string) => new Date(v).toLocaleString("zh-CN"),
              },
              {
                title: "类型",
                dataIndex: "kind",
                render: (v: string) => (v === "image" ? "图片" : "规划"),
              },
              { title: "账号 ID", dataIndex: "userId", ellipsis: true },
              { title: "任务 ID", dataIndex: "id", ellipsis: true },
              { title: "错误码", dataIndex: "code", ellipsis: true },
            ]}
          />
          <h3>近期管理审计</h3>
          <Table
            rowKey="id"
            dataSource={data.audits}
            pagination={{ pageSize: 5 }}
            columns={[
              {
                title: "时间",
                dataIndex: "createdAt",
                render: (v: string) => new Date(v).toLocaleString("zh-CN"),
              },
              {
                title: "操作",
                dataIndex: "action",
                render: (v: string) =>
                  ({
                    "execution-settings": "执行设置",
                    "planning-policy": "规划策略",
                    "image-resolution": "图片核验",
                  })[v] ?? v,
              },
              { title: "操作人 ID", dataIndex: "actorId", ellipsis: true },
              {
                title: "目标账号 ID",
                dataIndex: "targetId",
                ellipsis: true,
                render: (v: string | null) => v ?? "—",
              },
            ]}
          />
        </>
      )}
      {settings.data && <ExecutionSettingsForm initial={settings.data} />}
      <h3>每用户规划策略</h3>
      <ChoiceField
        label="规划策略账号"
        value={user}
        onValueChange={setSelected}
        options={allUsers.map((u) => ({ value: u.id, label: u.username }))}
      />
      {users.hasNextPage && (
        <Button onClick={() => void users.fetchNextPage()}>
          加载更多策略账号
        </Button>
      )}
      {user && <PlanningPolicyForm key={user} userId={user} />}
    </section>
  );
}
function ExecutionSettingsForm({ initial }: { initial: ExecutionSettings }) {
  const state = useSessionState(),
    [draft, setDraft] = useState<ExecutionSettings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const current = draft ?? initial;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await client(state.session.csrfToken)(
        "/image-admin/execution-settings",
        current,
      );
      await state.queries.invalidateQueries({
        queryKey: state.key("execution-settings"),
      });
      setDraft(null);
      setMessage("执行设置已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} aria-label="保存全局执行设置">
      <h3>全局执行与排队</h3>
      <p className="hint">
        调整并发不会撤销已接受的预留，也不启动第二个 Worker。
      </p>
      <div className="parameter-grid">
        {(["images", "planning"] as const).map((kind) => (
          <div key={kind}>
            <Field
              label={`${kind === "images" ? "全局图片" : "全局规划"}并发`}
              type="number"
              min={1}
              max={16}
              value={current[kind].concurrency}
              disabled={busy}
              required
              onChange={(e) =>
                setDraft({
                  ...current,
                  [kind]: {
                    ...current[kind],
                    concurrency: Number(e.target.value),
                  },
                })
              }
            />
            <Field
              label={`${kind === "images" ? "全局图片" : "全局规划"}排队上限`}
              type="number"
              min={1}
              max={1000}
              value={current[kind].queueLimit}
              disabled={busy}
              required
              onChange={(e) =>
                setDraft({
                  ...current,
                  [kind]: {
                    ...current[kind],
                    queueLimit: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <Button disabled={busy}>保存执行设置</Button>
    </form>
  );
}
function PlanningPolicyForm({ userId }: { userId: string }) {
  const state = useSessionState(),
    [draft, setDraft] = useState<PlanningPolicy | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const query = useQuery({
      queryKey: state.key("planning-policy", userId),
      queryFn: ({ signal }) =>
        client(state.session.csrfToken)<PlanningPolicy>(
          `/image-admin/planning-policies/${userId}`,
          undefined,
          signal,
        ),
    }),
    current = draft ?? query.data;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await client(state.session.csrfToken)(
        `/image-admin/planning-policies/${userId}`,
        current,
      );
      await Promise.all([
        state.queries.invalidateQueries({
          queryKey: state.key("planning-policy", userId),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("planning-usage"),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("admin-summary"),
        }),
      ]);
      setDraft(null);
      setMessage("规划策略已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (query.error) return <Notice error>{query.error.message}</Notice>;
  if (!current) return <p role="status">正在读取规划策略…</p>;
  return (
    <form onSubmit={save} aria-label="保存规划策略">
      <div className="parameter-grid">
        <Field
          label="每日规划次数"
          type="number"
          min={0}
          max={10000}
          value={current.dailyLimit}
          disabled={busy}
          required
          onChange={(e) =>
            setDraft({ ...current, dailyLimit: Number(e.target.value) })
          }
        />
        <Field
          label="每用户规划并发"
          type="number"
          min={1}
          max={8}
          value={current.concurrency}
          disabled={busy}
          required
          onChange={(e) =>
            setDraft({ ...current, concurrency: Number(e.target.value) })
          }
        />
        <Field
          label="每用户规划排队上限"
          type="number"
          min={1}
          max={100}
          value={current.queueLimit}
          disabled={busy}
          required
          onChange={(e) =>
            setDraft({ ...current, queueLimit: Number(e.target.value) })
          }
        />
      </div>
      <p className="hint">
        降低次数上限只阻止新的超额提交，已接受的预留继续保留。
      </p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <Button disabled={busy}>保存规划策略</Button>
    </form>
  );
}
