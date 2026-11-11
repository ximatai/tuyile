import {
  Button,
  Checkbox,
  Collapse,
  Input,
  Modal,
  Notice,
  Steps,
  Tag,
  useConfirm,
} from "@tuyile/ui";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExternalAgentAccountConnection } from "@tuyile/contracts";
import { ArrowUpRight, CheckCircle2, Copy } from "lucide-react";
import { ApiError, client } from "./api";
import { useSessionState } from "./session-state";

const scopeLabels = {
  "canvas:read": "读取",
  "canvas:write": "编辑",
  "images:generate": "生图",
  "images:download": "原图链接",
};
const accountConnectionPath = "/account/external-agent";
const accountConnectionKey = "codex-account-connection";

function codexConnectionName(accountId: string) {
  return `tuyile_account_${accountId.replaceAll("-", "")}`;
}

export function codexProjectPrompt(accountId: string, projectId: string) {
  const url = new URL(`/projects/${projectId}`, location.origin).href;
  return `请用图一乐 MCP（${codexConnectionName(accountId)}）读取这个项目的最新画布：${url}。接下来我会告诉你如何处理。`;
}

export function useCodexAccountConnection() {
  const state = useSessionState();
  return useQuery({
    queryKey: state.key(accountConnectionKey),
    queryFn: ({ signal }) =>
      client(state.session.csrfToken)<ExternalAgentAccountConnection>(
        accountConnectionPath,
        undefined,
        signal,
      ),
  });
}

export function CodexConnection({
  projectId,
  handoffCopied,
  onBusyChange,
}: {
  projectId?: string;
  handoffCopied?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const state = useSessionState();
  const { session } = state;
  const confirm = useConfirm();
  const csrf = session.csrfToken;
  const mcpUrl = new URL("/mcp", location.origin).href;
  const connectionName = codexConnectionName(session.user.id);
  const tokenVariable = `${connectionName.toUpperCase()}_TOKEN`;
  const prompt = projectId
    ? codexProjectPrompt(session.user.id, projectId)
    : `请调用图一乐 MCP（${connectionName}）的 check_connection 工具，验证账号连接。`;
  const config = `[mcp_servers.${connectionName}]
url = "${mcpUrl}"
bearer_token_env_var = "${tokenVariable}"`;
  const [connection, setConnection] =
    useState<ExternalAgentAccountConnection>();
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [allowCanvasWrite, setAllowCanvasWrite] = useState(false);
  const [allowGeneration, setAllowGeneration] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [token, setToken] = useState("");
  const [grantReplaced, setGrantReplaced] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (connection && !busy) stepHeading.current?.focus();
  }, [connection, busy, step]);
  useEffect(() => {
    const controller = new AbortController();
    void client(csrf)<ExternalAgentAccountConnection>(
      accountConnectionPath,
      undefined,
      controller.signal,
    )
      .then((result) => {
        setConnection(result);
        setAllowGeneration(result.savedScopes.includes("images:generate"));
        setAllowDownload(result.savedScopes.includes("images:download"));
        setAllowCanvasWrite(result.savedScopes.includes("canvas:write"));
        setStep(result.grant ? 1 : 0);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setLoadError(cause.message);
      });
    return () => controller.abort();
  }, [csrf, loadAttempt]);

  function setWorking(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }

  async function change(action: "issue" | "revoke") {
    if (
      action === "revoke" &&
      !(await confirm(
        "撤销账号令牌后，使用它连接的 Codex 将无法访问图一乐项目。",
        () => stepHeading.current?.focus(),
      ))
    )
      return;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      const expectedGrantId = connection?.grant?.id ?? null;
      const { token: issuedToken, ...response } = await client(csrf)<
        ExternalAgentAccountConnection & { token?: string }
      >(
        accountConnectionPath,
        action === "issue"
          ? {
              action,
              allowCanvasWrite,
              allowGeneration,
              allowDownload,
              expectedGrantId,
            }
          : { action, expectedGrantId },
      );
      setConnection(response);
      setToken(issuedToken ?? "");
      setGrantReplaced(false);
      setStep(response.grant ? 1 : 0);
      setAllowCanvasWrite(response.savedScopes.includes("canvas:write"));
      setAllowGeneration(response.savedScopes.includes("images:generate"));
      setAllowDownload(response.savedScopes.includes("images:download"));
      void state.queries.invalidateQueries({
        queryKey: state.key(accountConnectionKey),
      });
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === "EXTERNAL_AGENT_GRANT_CHANGED"
      ) {
        setConnection(undefined);
        setToken("");
        setGrantReplaced(false);
        setLoadError("");
        setLoadAttempt((attempt) => attempt + 1);
        void state.queries.invalidateQueries({
          queryKey: state.key(accountConnectionKey),
        });
      }
      setError((cause as Error).message);
    } finally {
      setWorking(false);
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
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      const latest = await client(csrf)<ExternalAgentAccountConnection>(
        accountConnectionPath,
      );
      setConnection(latest);
      state.queries.setQueryData(state.key(accountConnectionKey), latest);
      if (!latest.grant) {
        setToken("");
        setAllowCanvasWrite(latest.savedScopes.includes("canvas:write"));
        setAllowGeneration(latest.savedScopes.includes("images:generate"));
        setAllowDownload(latest.savedScopes.includes("images:download"));
        setStep(0);
        setGrantReplaced(false);
        setFeedback("令牌已失效，请重新签发。");
      } else if (latest.grant.id !== connection?.grant?.id) {
        setToken("");
        setAllowCanvasWrite(latest.grant.scopes.includes("canvas:write"));
        setAllowGeneration(latest.grant.scopes.includes("images:generate"));
        setAllowDownload(latest.grant.scopes.includes("images:download"));
        setGrantReplaced(true);
        setStep(0);
      } else if (!latest.grant.verifiedAt) {
        setFeedback("还未收到验证请求。请先在 Codex 发送验证提示。");
      } else {
        setToken("");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setWorking(false);
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
          <h3 tabIndex={-1} ref={stepHeading}>
            Codex 已连接
          </h3>
          <p>
            {projectId
              ? "复制当前项目的提示，在 Codex 中继续。"
              : "打开任意项目，在画布点击「在 Codex 中继续」即可开始。"}
          </p>
        </div>
      </div>
      {projectId && (
        <>
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
        </>
      )}
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
          { title: "验证连接" },
        ]}
      />
      {step === 0 && (
        <div className="external-agent-card external-agent-stack">
          <div>
            <h3 tabIndex={-1} ref={stepHeading}>
              {grantReplaced
                ? "需要重新配置 Codex"
                : grant
                  ? "更换账号令牌"
                  : "授权 Codex 访问你的项目"}
            </h3>
            <p>
              {grantReplaced
                ? "账号令牌已在其他页面换发。请签发新令牌并重新配置 Codex。"
                : grant
                  ? "签发新令牌后，旧令牌立即失效。"
                  : "权限适用于你能访问的所有项目。"}
            </p>
          </div>
          <div className="external-agent-permissions">
            <Checkbox checked disabled>
              读取画布和项目图片
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
            <Checkbox
              checked={allowDownload}
              disabled={busy}
              onChange={(event) => setAllowDownload(event.target.checked)}
            >
              允许生成原图下载链接{" "}
              <span className="external-agent-muted">
                · 链接有效期内，持有者可下载原图
              </span>
            </Checkbox>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="external-agent-card external-agent-stack">
          <div>
            <h3 tabIndex={-1} ref={stepHeading}>
              在 Codex 中添加图一乐
            </h3>
            <p>
              把下面的配置加入 <code>~/.codex/config.toml</code>。
            </p>
          </div>
          {configBlock}
          <div className="external-agent-token">
            <p>
              将账号令牌设为下方环境变量，再从能读取该变量的环境启动 Codex。
            </p>
            <code className="external-agent-env">{tokenVariable}</code>
            {token ? (
              <div className="external-agent-token-row">
                <Input.Password
                  aria-label="账号访问令牌"
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
            <h3 tabIndex={-1} ref={stepHeading}>
              在 Codex 中验证连接
            </h3>
            <p>
              复制验证提示并在 Codex 中发送。Codex 返回结果后，回来检查连接。
            </p>
          </div>
          <Input.TextArea
            aria-label="给 Codex 的验证提示"
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
  return (
    <>
      {connectionContent}
      {(feedback || (verified && handoffCopied)) && (
        <div className="external-agent-feedback" role="status">
          {feedback || "已复制项目提示"}
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
    </>
  );
}

export function CodexAccountDialog({
  open,
  onClose,
  afterClose,
}: {
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      title="连接 Codex"
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
      destroyOnHidden
      focusable={{ focusTriggerAfterClose: false }}
      afterClose={afterClose}
      footer={null}
      width={680}
    >
      <div className="external-agent-dialog">
        <CodexConnection onBusyChange={setBusy} />
      </div>
    </Modal>
  );
}
