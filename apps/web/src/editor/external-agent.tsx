import {
  Button,
  Checkbox,
  Input,
  Modal,
  Notice,
  Table,
  useConfirm,
} from "@tuyile/ui";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CanvasSnapshot,
  ExternalAgentActivity,
  ExternalAgentConnection,
} from "@tuyile/contracts";
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
  const activityToggle = useRef<HTMLButtonElement>(null);
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
  const [allowCanvasWrite, setAllowCanvasWrite] = useState(false);
  const [allowGeneration, setAllowGeneration] = useState(false);
  const [token, setToken] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const csrf = session.csrfToken;
  const [showActivity, setShowActivity] = useState(false);
  const [offset, setOffset] = useState(0);
  const activityKey = state.key("external-agent-activity", projectId);
  const activity = useQuery({
    queryKey: [...activityKey, editor.get().revision, offset],
    enabled: showActivity,
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
        setShowSetup(!result.grant);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [csrf, path]);

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
      activityToggle.current?.focus();
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

  return (
    <Modal
      open
      title="在 Codex 中继续"
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
      footer={null}
      width={showActivity ? 720 : undefined}
    >
      <div className="external-agent-dialog">
        <Input.TextArea
          aria-label="给 Codex 的项目提示"
          value={prompt}
          readOnly
          autoSize
        />
        <div className="actions">
          <Button
            className="primary"
            onClick={() => void copy(prompt, "已复制项目提示")}
          >
            复制给 Codex
          </Button>
          <Button onClick={() => setShowSetup((value) => !value)}>
            {showSetup ? "收起连接设置" : "首次连接与授权"}
          </Button>
          <Button
            ref={activityToggle}
            onClick={() => setShowActivity((value) => !value)}
          >
            {showActivity ? "收起活动记录" : "项目活动记录"}
          </Button>
        </div>
        {showSetup && (
          <>
            <p>
              将下方配置加入 Codex 的 <code>~/.codex/config.toml</code>
              。把访问令牌设为启动 Codex 时可读取的环境变量{" "}
              <code>{tokenVariable}</code>，重新打开 Codex 后粘贴项目提示。
            </p>
            <Input.TextArea
              aria-label="Codex MCP 配置"
              value={config}
              readOnly
              autoSize
            />
            <Checkbox
              checked={allowCanvasWrite}
              disabled={busy || !connection}
              onChange={(event) => setAllowCanvasWrite(event.target.checked)}
            >
              允许编辑画布
            </Checkbox>
            <Checkbox
              checked={allowGeneration}
              disabled={busy || !connection}
              onChange={(event) => setAllowGeneration(event.target.checked)}
            >
              允许提交生图（成功图片计入额度）
            </Checkbox>
            <div className="actions">
              <Button onClick={() => void copy(config, "已复制 MCP 配置")}>
                复制配置
              </Button>
              <Button
                loading={busy}
                disabled={!connection}
                onClick={() => void change("issue")}
              >
                {connection?.grant ? "替换令牌" : "签发令牌"}
              </Button>
              {connection?.grant && (
                <Button disabled={busy} onClick={() => void change("revoke")}>
                  撤销令牌
                </Button>
              )}
            </div>
            <div>
              {connection?.grant
                ? `当前授权：读取${connection.grant.scopes.includes("canvas:write") ? "、编辑" : ""}${connection.grant.scopes.includes("images:generate") ? "、生图" : ""}，截至 ${new Date(connection.grant.expiresAt).toLocaleString("zh-CN")}`
                : connection
                  ? "当前项目尚未授权。"
                  : "正在读取授权状态…"}{" "}
              令牌允许读取当前项目。勾选的权限在签发或替换时生效，有效期为 7
              天。
            </div>
            {token && (
              <>
                <Input.Password
                  aria-label="项目访问令牌"
                  value={token}
                  readOnly
                  autoComplete="off"
                />
                <Button onClick={() => void copy(token, "已复制访问令牌")}>
                  复制访问令牌
                </Button>
                <div>请单独配置此令牌。关闭弹窗后无法再次查看。</div>
              </>
            )}
          </>
        )}
        {showActivity && (
          <>
            {undoRevision != null && (
              <div className="actions">
                <Button
                  disabled={busy || !canUndo(undoRevision)}
                  onClick={() => void undo(undoRevision)}
                >
                  撤销最近一次外部编辑
                </Button>
                {!canUndo(undoRevision) && (
                  <span>请先处理未保存修改或同步画布。</span>
                )}
              </div>
            )}
            {activity.error && <Notice error>{activity.error.message}</Notice>}
            <Table<ExternalAgentActivity>
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ y: 260 }}
              loading={activity.isFetching}
              dataSource={activity.data?.items ?? []}
              locale={{ emptyText: "暂无外部 Agent 活动" }}
              columns={[
                {
                  title: "时间",
                  dataIndex: "createdAt",
                  render: (date: string) =>
                    new Date(date).toLocaleString("zh-CN"),
                },
                { title: "操作者", dataIndex: "actor" },
                {
                  title: "操作",
                  dataIndex: "action",
                  render: (action: ExternalAgentActivity["action"]) =>
                    activityLabels[action],
                },
                {
                  title: "结果",
                  render: (_, row) =>
                    row.revision !== null ? (
                      `v${row.revision}`
                    ) : row.taskId ? (
                      <span style={{ overflowWrap: "anywhere" }}>
                        {row.taskId}
                      </span>
                    ) : (
                      row.scopes?.map((scope) => scopeLabels[scope]).join("、")
                    ),
                },
              ]}
            />
            <div className="actions">
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
          </>
        )}
        {feedback && <div role="status">{feedback}</div>}
        {error && <Notice error>{error}</Notice>}
      </div>
    </Modal>
  );
}
