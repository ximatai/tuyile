import {
  Button,
  Checkbox,
  Collapse,
  Input,
  Modal,
  Notice,
  Table,
  Steps,
  Tabs,
  Tag,
  useConfirm,
} from "@tuyile/ui";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CanvasSnapshot,
  ExternalAgentActivity,
  ExternalAgentConnection,
  ImageTask,
} from "@tuyile/contracts";
import { ArrowUpRight, CheckCircle2, Copy } from "lucide-react";
import { TaskDetails } from "../task-details";
import { taskStates } from "../task-presentation";
import { client } from "../api";
import type { EditorStore } from "./store";
import { useSessionState } from "../session-state";

const activityLabels: Record<ExternalAgentActivity["action"], string> = {
  grant_issued: "签发令牌",
  grant_revoked: "撤销令牌",
  canvas_edited: "外部 Agent 修改画布",
  image_submitted: "外部 Agent 提交生图",
  canvas_undone: "撤销外部编辑",
};
const scopeLabels = {
  "canvas:read": "读取",
  "canvas:write": "编辑",
  "images:generate": "生图",
};

export function ExternalAgentDialog({
  projectId,
  editor,
  onClose,
}: {
  projectId: string;
  editor: EditorStore;
  onClose: () => void;
}) {
  const state = useSessionState();
  const confirm = useConfirm();
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const undoKey = useRef<{ revision: number; requestKey: string }>(undefined);
  const { session } = state;
  const path = `/projects/${projectId}/external-agent`;
  const projectUrl = new URL(`/projects/${projectId}`, location.origin).href;
  const mcpUrl = new URL("/mcp", location.origin).href;
  const connectionName = `tuyile_${projectId.replaceAll("-", "")}`;
  const tokenVariable = `${connectionName.toUpperCase()}_TOKEN`;
  const prompt = `请用图一乐 MCP（${connectionName}）读取这个项目的最新画布：${projectUrl}。接下来我会告诉你如何处理。`;
  const config = `[mcp_servers.${connectionName}]
url = "${mcpUrl}"
bearer_token_env_var = "${tokenVariable}"`;
  const [connection, setConnection] = useState<ExternalAgentConnection>();
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [allowCanvasWrite, setAllowCanvasWrite] = useState(false);
  const [allowGeneration, setAllowGeneration] = useState(false);
  const [token, setToken] = useState("");
  const [grantReplaced, setGrantReplaced] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const csrf = session.csrfToken;
  const [tab, setTab] = useState("connection");
  const [taskId, setTaskId] = useState<string>();
  const task = useQuery({
    queryKey: state.key("external-agent-task", projectId, taskId ?? ""),
    enabled: tab === "activity" && !!taskId,
    queryFn: ({ signal }) =>
      client(csrf)<ImageTask>(`/images/tasks/${taskId}`, undefined, signal),
    refetchInterval: ({ state: { data } }) =>
      data?.state === "queued" || data?.state === "running" ? 1500 : false,
  });
  const [offset, setOffset] = useState(0);
  const activityKey = state.key("external-agent-activity", projectId);
  const activity = useQuery({
    queryKey: [...activityKey, editor.get().revision, offset],
    enabled: tab === "activity",
    queryFn: ({ signal }) =>
      client(csrf)<{
        items: ExternalAgentActivity[];
        hasMore: boolean;
        undoRevision: number | null;
      }>(`${path}/activity?offset=${offset}`, undefined, signal),
  });
  useEffect(() => {
    const controller = new AbortController();
    void client(csrf)<ExternalAgentConnection>(
      path,
      undefined,
      controller.signal,
    )
      .then((result) => {
        setConnection(result);
        setAllowGeneration(
          result.grant?.scopes.includes("images:generate") ?? false,
        );
        setAllowCanvasWrite(
          result.grant?.scopes.includes("canvas:write") ?? false,
        );
        setStep(result.grant ? 1 : 0);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setLoadError(cause.message);
      });
    return () => controller.abort();
  }, [csrf, path, loadAttempt]);

  async function change(action: "issue" | "revoke") {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const response = await client(csrf)<
        ExternalAgentConnection & { token?: string }
      >(
        path,
        action === "issue"
          ? { action, allowCanvasWrite, allowGeneration }
          : { action },
      );
      setConnection(response);
      setToken(response.token ?? "");
      setGrantReplaced(false);
      setStep(response.grant ? 1 : 0);
      if (!response.grant) {
        setAllowCanvasWrite(false);
        setAllowGeneration(false);
      }
      await state.queries.invalidateQueries({ queryKey: activityKey });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const undoRevision = activity.data?.undoRevision;
  function canUndo(revision: number) {
    const current = editor.get();
    return (
      current.revision === revision &&
      !current.dirty &&
      !current.saving &&
      !current.conflict
    );
  }

  async function undo(revision: number) {
    if (!canUndo(revision)) return;
    if (
      !(await confirm(
        "将画布恢复到最近一次外部编辑前的版本。已生成的图片仍保留在图库。",
      ))
    )
      return;
    if (!canUndo(revision)) {
      setError("画布有新版本或未保存修改，请先检查画布。");
      return;
    }
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      if (undoKey.current?.revision !== revision)
        undoKey.current = { revision, requestKey: crypto.randomUUID() };
      const restored = await client(csrf)<CanvasSnapshot>(
        `${path}/undo`,
        undoKey.current,
      );
      editor.receiveRemote(restored);
      setFeedback(`已撤销外部编辑，当前画布版本为 v${restored.revision}。`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      await state.queries.invalidateQueries({ queryKey: activityKey });
      setBusy(false);
      activityHeading.current?.focus();
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(label);
    } catch {
      setFeedback("无法写入剪贴板，请从输入框手动复制。");
    }
  }

  async function checkConnection() {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const latest = await client(csrf)<ExternalAgentConnection>(path);
      setConnection(latest);
      if (!latest.grant) {
        setToken("");
        setAllowCanvasWrite(false);
        setAllowGeneration(false);
        setStep(0);
        setGrantReplaced(false);
        setFeedback("令牌已失效，请重新签发。");
      } else if (latest.grant.id !== connection?.grant?.id) {
        setToken("");
        setAllowCanvasWrite(latest.grant.scopes.includes("canvas:write"));
        setAllowGeneration(latest.grant.scopes.includes("images:generate"));
        setGrantReplaced(true);
        setStep(0);
      } else if (!latest.grant.verifiedAt) {
        setFeedback("还未收到读取请求。请先在 Codex 发送验证提示。");
      } else {
        setToken("");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const grant = connection?.grant;
  const verified = !!grant?.verifiedAt && !grantReplaced;
  const configBlock = (
    <>
      <Input.TextArea
        className="external-agent-code"
        aria-label="Codex MCP 配置"
        value={config}
        readOnly
        rows={3}
      />
      <Button
        type="button"
        onClick={() => void copy(config, "已复制 MCP 配置")}
      >
        <Copy size={14} />
        复制配置
      </Button>
    </>
  );
  const connectionPanel = !connection ? (
    loadError ? (
      <div className="external-agent-stack">
        <Notice error>{loadError}</Notice>
        <Button
          onClick={() => {
            setLoadError("");
            setLoadAttempt(loadAttempt + 1);
          }}
        >
          重试读取连接状态
        </Button>
      </div>
    ) : (
      <div className="external-agent-muted" role="status">
        正在读取连接状态…
      </div>
    )
  ) : verified && step !== 0 ? (
    <>
      <div className="external-agent-card external-agent-ready">
        <div className="external-agent-ready-icon">
          <CheckCircle2 size={21} />
        </div>
        <div>
          <h3>此项目已验证连接</h3>
          <p>复制项目提示，粘贴到 Codex 后告诉它你想做什么。</p>
        </div>
      </div>
      <Input.TextArea
        aria-label="给 Codex 的项目提示"
        value={prompt}
        readOnly
        rows={3}
      />
      <div className="external-agent-actions">
        <Button
          className="primary"
          onClick={() => void copy(prompt, "已复制项目提示")}
        >
          <Copy size={15} />
          复制给 Codex
        </Button>
      </div>
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: "manage",
            label: "配置与令牌管理",
            children: (
              <div className="external-agent-stack">
                {configBlock}
                <div className="external-agent-actions">
                  <Button disabled={busy} onClick={() => setStep(0)}>
                    更换权限或令牌
                  </Button>
                  <Button disabled={busy} onClick={() => void change("revoke")}>
                    撤销令牌
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
    </>
  ) : (
    <>
      <Steps
        current={step}
        size="small"
        items={[
          { title: "选择权限" },
          { title: "配置 Codex" },
          { title: "验证读取" },
        ]}
      />
      {step === 0 && (
        <div className="external-agent-card external-agent-stack">
          <div>
            <h3>
              {grantReplaced
                ? "需要重新配置 Codex"
                : grant
                  ? "更换项目令牌"
                  : "授权 Codex 访问此项目"}
            </h3>
            <p>
              {grantReplaced
                ? "此项目的令牌已在其他页面换发。请签发新令牌并重新配置 Codex。"
                : grant
                  ? "签发新令牌后，旧令牌立即失效。"
                  : "默认只允许读取当前画布。按需要开放更多操作。"}
            </p>
          </div>
          <div className="external-agent-permissions">
            <Checkbox checked disabled>
              读取画布
            </Checkbox>
            <Checkbox
              checked={allowCanvasWrite}
              disabled={busy}
              onChange={(event) => setAllowCanvasWrite(event.target.checked)}
            >
              允许编辑画布
            </Checkbox>
            <Checkbox
              checked={allowGeneration}
              disabled={busy}
              onChange={(event) => setAllowGeneration(event.target.checked)}
            >
              允许提交生图{" "}
              <span className="external-agent-muted">· 成功图片计入额度</span>
            </Checkbox>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="external-agent-card external-agent-stack">
          <div>
            <h3>在 Codex 中添加图一乐</h3>
            <p>
              把下面的配置加入 <code>~/.codex/config.toml</code>。
            </p>
          </div>
          {configBlock}
          <div className="external-agent-token">
            <p>
              将项目令牌设为下方环境变量，再从能读取该变量的环境启动 Codex。
            </p>
            <code className="external-agent-env">{tokenVariable}</code>
            {token ? (
              <div className="external-agent-token-row">
                <Input.Password
                  aria-label="项目访问令牌"
                  value={token}
                  readOnly
                  autoComplete="off"
                />
                <Button onClick={() => void copy(token, "已复制访问令牌")}>
                  复制令牌
                </Button>
              </div>
            ) : (
              <p>已签发的令牌只显示一次。若未保存，请更换令牌。</p>
            )}
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="external-agent-card external-agent-stack">
          <div>
            <h3>在 Codex 中读取一次画布</h3>
            <p>
              复制验证提示并在 Codex 中发送。看到 Codex
              返回画布后，回来检查连接。
            </p>
          </div>
          <Input.TextArea
            aria-label="给 Codex 的项目提示"
            value={prompt}
            readOnly
            rows={3}
          />
          <Button onClick={() => void copy(prompt, "已复制验证提示")}>
            复制验证提示
          </Button>
        </div>
      )}
      <div className="external-agent-actions">
        {step === 0 ? (
          <>
            {grant && !grantReplaced && (
              <Button disabled={busy} onClick={() => setStep(1)}>
                返回
              </Button>
            )}
            <Button
              className="primary"
              loading={busy}
              onClick={() => void change("issue")}
            >
              {grant ? "替换令牌并继续" : "签发令牌并继续"}
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={() => setStep(step - 1)}>
              上一步
            </Button>
            {step === 1 ? (
              <Button className="primary" onClick={() => setStep(2)}>
                继续验证 <ArrowUpRight size={15} />
              </Button>
            ) : (
              <Button
                className="primary"
                loading={busy}
                onClick={() => void checkConnection()}
              >
                检查连接
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );

  const connectionContent = (
    <>
      {grant && (
        <div className="external-agent-grant">
          <Tag color={verified ? "success" : "blue"}>
            {grantReplaced
              ? "令牌已换发"
              : verified
                ? "已验证"
                : "已签发 · 待验证"}
          </Tag>
          <span>
            {grant.scopes.map((scope) => scopeLabels[scope]).join("、")}
          </span>
          <span>
            有效至 {new Date(grant.expiresAt).toLocaleDateString("zh-CN")}
          </span>
          {!verified && (
            <Button disabled={busy} onClick={() => void change("revoke")}>
              撤销令牌
            </Button>
          )}
        </div>
      )}
      {connectionPanel}
    </>
  );
  const activityContent = taskId ? (
    <div className="external-agent-stack">
      <div className="external-agent-actions">
        <Button onClick={() => setTaskId(undefined)}>返回活动记录</Button>
      </div>
      {task.error ? (
        <Notice error>{task.error.message}</Notice>
      ) : task.data ? (
        <>
          <Tag>{taskStates[task.data.state]}</Tag>
          <TaskDetails task={task.data} />
          <div className="external-agent-muted">
            任务 ID <code>{taskId}</code>
          </div>
        </>
      ) : (
        <div role="status">正在读取任务…</div>
      )}
    </div>
  ) : (
    <>
      <h3
        className="external-agent-activity-title"
        tabIndex={-1}
        ref={activityHeading}
      >
        外部 Agent 活动
      </h3>
      {activity.error && <Notice error>{activity.error.message}</Notice>}
      <Table<ExternalAgentActivity>
        size="small"
        rowKey="id"
        pagination={false}
        scroll={{ y: 320 }}
        loading={activity.isFetching}
        dataSource={activity.data?.items ?? []}
        locale={{ emptyText: "暂无外部 Agent 活动" }}
        columns={[
          {
            title: "操作",
            dataIndex: "action",
            render: (action: ExternalAgentActivity["action"]) =>
              activityLabels[action],
          },
          {
            title: "时间",
            dataIndex: "createdAt",
            render: (date: string) =>
              new Date(date).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
          },
          { title: "操作者", dataIndex: "actor" },
          {
            title: "结果",
            render: (_, row) => {
              if (row.taskId)
                return (
                  <Button onClick={() => setTaskId(row.taskId!)}>
                    查看任务
                  </Button>
                );
              if (row.revision === null)
                return row.scopes
                  ?.map((scope) => scopeLabels[scope])
                  .join("、");
              const revision = row.revision;
              return (
                <div className="external-agent-row-action">
                  <Tag>v{revision}</Tag>
                  {row.action === "canvas_edited" &&
                    revision === undoRevision && (
                      <Button
                        disabled={busy || !canUndo(revision)}
                        onClick={() => void undo(revision)}
                        title={
                          canUndo(revision)
                            ? undefined
                            : "请先处理未保存修改或同步画布"
                        }
                      >
                        撤销 v{revision}
                      </Button>
                    )}
                </div>
              );
            },
          },
        ]}
      />
      {!!(offset || activity.data?.hasMore) && (
        <div className="external-agent-actions">
          <Button
            disabled={!offset || activity.isFetching}
            onClick={() => setOffset(offset - 20)}
          >
            上一页
          </Button>
          <Button
            disabled={!activity.data?.hasMore || activity.isFetching}
            onClick={() => setOffset(offset + 20)}
          >
            下一页
          </Button>
        </div>
      )}
    </>
  );
  const feedbackContent = (
    <>
      {feedback && (
        <div className="external-agent-feedback" role="status">
          {feedback}
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
    </>
  );
  return (
    <Modal
      open
      title="在 Codex 中继续"
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
      footer={null}
      width={680}
    >
      <Tabs
        activeKey={tab}
        destroyOnHidden
        onChange={(key) => {
          setTab(key);
          setFeedback("");
          setError("");
        }}
        items={[
          {
            key: "connection",
            label: "连接设置",
            children: (
              <div className="external-agent-dialog">
                {connectionContent}
                {feedbackContent}
              </div>
            ),
          },
          {
            key: "activity",
            label: "项目活动记录",
            children: (
              <div className="external-agent-dialog">
                {activityContent}
                {feedbackContent}
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
