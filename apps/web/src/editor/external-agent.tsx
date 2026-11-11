import { Button, Checkbox, Input, Modal, Notice } from "@tuyile/ui";
import { useEffect, useState } from "react";
import type { ExternalAgentConnection } from "@tuyile/contracts";
import { client } from "../api";
import { useSessionState } from "../session-state";

export function ExternalAgentDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { session } = useSessionState();
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
  const [token, setToken] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const csrf = session.csrfToken;
  useEffect(() => {
    const controller = new AbortController();
    void client(csrf)<ExternalAgentConnection>(
      path,
      undefined,
      controller.signal,
    )
      .then((result) => {
        setConnection(result);
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
      >(path, action === "issue" ? { action, allowCanvasWrite } : { action });
      setConnection(response);
      setToken(response.token ?? "");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
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
        </div>
        {showSetup && (
          <>
            <p>
              将下方配置加入 Codex 的 config.toml。把访问令牌设为启动 Codex
              时可读取的环境变量 <code>{tokenVariable}</code>，重新打开 Codex
              后粘贴项目提示。
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
                ? `授权截至 ${new Date(connection.grant.expiresAt).toLocaleString("zh-CN")}`
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
        {feedback && <div role="status">{feedback}</div>}
        {error && <Notice error>{error}</Notice>}
      </div>
    </Modal>
  );
}
