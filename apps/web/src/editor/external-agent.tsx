import {
  Button,
  Modal,
  Notice,
  Table,
  Tabs,
  Tag,
  useConfirm,
} from "@tuyile/ui";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CanvasSnapshot,
  ExternalAgentActivity,
  ExternalAgentConnection,
  ImageTask,
} from "@tuyile/contracts";
import { TaskDetails } from "../task-details";
import { taskStates } from "../task-presentation";
import { client } from "../api";
import type { EditorStore } from "./store";
import { useSessionState } from "../session-state";
import { CodexConnection } from "../codex-connection";

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
  "images:download": "原图链接",
};

export function ExternalAgentDialog({
  projectId,
  editor,
  handoffCopied,
  onClose,
}: {
  projectId: string;
  editor: EditorStore;
  handoffCopied: boolean;
  onClose: () => void;
}) {
  const state = useSessionState();
  const confirm = useConfirm();
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const undoKey = useRef<{ revision: number; requestKey: string }>(undefined);
  const { session } = state;
  const path = `/projects/${projectId}/external-agent`;
  const [busy, setBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
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
  const legacyConnection = useQuery({
    queryKey: state.key("external-agent-legacy", projectId),
    queryFn: ({ signal }) =>
      client(csrf)<ExternalAgentConnection>(path, undefined, signal),
  });

  async function revokeLegacy() {
    if (!(await confirm("撤销旧项目令牌。账号级 Codex 连接可以继续使用。")))
      return;
    setBusy(true);
    setError("");
    try {
      await client(csrf)(path, { action: "revoke" });
      await legacyConnection.refetch();
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
      onCancel={busy || connectionBusy ? undefined : onClose}
      closable={!busy && !connectionBusy}
      mask={{ closable: !busy && !connectionBusy }}
      keyboard={!busy && !connectionBusy}
      footer={null}
      width={680}
    >
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          if (busy || connectionBusy) return;
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
                <CodexConnection
                  projectId={projectId}
                  handoffCopied={handoffCopied}
                  onBusyChange={setConnectionBusy}
                />
                {legacyConnection.data?.grant && (
                  <div className="external-agent-card external-agent-stack">
                    <div>
                      此项目仍有一枚旧项目令牌，可在账号连接配置完成后撤销。
                    </div>
                    <div className="external-agent-actions">
                      <Button
                        disabled={busy || connectionBusy}
                        onClick={() => void revokeLegacy()}
                      >
                        撤销旧项目令牌
                      </Button>
                    </div>
                    {error && <Notice error>{error}</Notice>}
                  </div>
                )}
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
