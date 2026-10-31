import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ImageTask, ImageUsage } from "@tuyile/contracts";
import {
  Card,
  Statistic,
  Progress,
  Collapse,
  Descriptions,
  Table,
  Drawer,
  Image,
  Button,
  Notice,
  Tag,
  Tooltip,
} from "@tuyile/ui";
import { RefreshCw, Info, Download, ArrowUpRight } from "lucide-react";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { formatStorage, quotaPercentage } from "./usage-metrics";

const states = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "未完成",
  cancelled: "已取消",
};
function TaskStatus({ task }: { task: ImageTask }) {
  return (
    <Tag
      color={
        task.pendingReview
          ? "warning"
          : task.state === "succeeded"
            ? "success"
            : ["queued", "running"].includes(task.state)
              ? "processing"
              : task.state === "failed"
                ? "error"
                : "default"
      }
    >
      {task.pendingReview ? "结果待确认" : states[task.state]}
    </Tag>
  );
}
function taskTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function Overview({ usage }: { usage: ImageUsage }) {
  const unlimited = usage.available === null;
  return (
    <>
      <div className="usage-overview" aria-label="额度概览">
        <Card role="region" aria-label="图片额度" size="small">
          <div className="usage-metric-heading">
            <span>今日可用</span>
            <span className="hint">每日 00:00 重置</span>
          </div>
          <Statistic
            value={unlimited ? "不限额" : (usage.available ?? 0)}
            suffix={unlimited ? undefined : "张"}
          />
          <div className="usage-meter">
            {!unlimited && (
              <Progress
                aria-label="今日图片额度使用比例"
                percent={quotaPercentage(
                  usage.used + usage.held,
                  usage.policy.imageLimit,
                )}
                showInfo={false}
              />
            )}
          </div>
          <div className="usage-metric-footer">
            <span>已生成 {usage.used} 张</span>
            {usage.held > 0 && (
              <Tooltip title="已提交任务暂占的额度，结算后更新。">
                <span className="usage-pending">
                  待结算 {usage.held} 张 <Info size={13} />
                </span>
              </Tooltip>
            )}
          </div>
        </Card>
        <Card role="region" aria-label="存储空间" size="small">
          <div className="usage-metric-heading">
            <span>已用空间</span>
          </div>
          <Statistic
            value={formatStorage(usage.storageUsed)}
            suffix={`/ ${formatStorage(usage.policy.storageLimit)}`}
          />
          <div className="usage-meter">
            <Progress
              aria-label="存储使用比例"
              percent={quotaPercentage(
                usage.storageUsed + usage.storageReserved,
                usage.policy.storageLimit,
              )}
              showInfo={false}
              status={
                usage.storageUsed + usage.storageReserved >
                usage.policy.storageLimit
                  ? "exception"
                  : "normal"
              }
            />
          </div>
          <div className="usage-metric-footer">
            <span>
              {usage.storageReserved > 0
                ? `另有 ${formatStorage(usage.storageReserved)} 待结算`
                : usage.policy.storageLimit === 0
                  ? "暂无存储额度"
                  : ""}
            </span>
            <Link to="/gallery">
              管理图片 <ArrowUpRight size={14} />
            </Link>
          </div>
        </Card>
      </div>
      {usage.earlierHeld > 0 && (
        <p className="hint">历史任务另有 {usage.earlierHeld} 张待结算。</p>
      )}
      <Collapse
        ghost
        size="small"
        className="usage-limits"
        items={[
          {
            key: "limits",
            label: "额度详情",
            children: (
              <>
                <Descriptions
                  size="small"
                  column={2}
                  items={[
                    {
                      key: "images",
                      label: "每日图片上限",
                      children:
                        usage.policy.imageLimit === -1
                          ? "不限额"
                          : `${usage.policy.imageLimit} 张`,
                    },
                    {
                      key: "calls",
                      label: "今日模型调用",
                      children: `${usage.attempts} / ${usage.policy.attemptsLimit} 次`,
                    },
                    {
                      key: "count",
                      label: "单次最多生成",
                      children: `${usage.policy.maxCount} 张`,
                    },
                    {
                      key: "concurrency",
                      label: "同时执行",
                      children: `${usage.policy.concurrency} 个任务`,
                    },
                  ]}
                />
                <p className="hint">
                  图片额度仅统计已保存图片，实际费用以模型服务账单为准。每日额度按北京时间重置。
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
}

export function UsagePage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState(),
    api = client(csrfToken);
  const [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ImageTask | null>(null);
  const [actionError, setActionError] = useState(""),
    [cancelling, setCancelling] = useState(false);
  const usageQuery = useQuery({
    queryKey: state.key("usage"),
    queryFn: ({ signal }) =>
      api<ImageUsage>("/images/usage", undefined, signal),
  });
  const tasksQuery = useInfiniteQuery({
    queryKey: state.key("all-image-tasks"),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<{ tasks: ImageTask[]; hasMore: boolean }>(
        `/images/tasks?offset=${pageParam}`,
        undefined,
        signal,
      ),
    getNextPageParam: (page, pages) =>
      page.hasMore ? pages.length * 50 : undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.tasks.some((task) => ["queued", "running"].includes(task.state)),
      )
        ? 1500
        : false,
  });
  const lastUsage = useRef<string | null>(null);
  const usageSignature = usageQuery.data
    ? `${usageQuery.data.day}:${usageQuery.data.used}:${usageQuery.data.held}:${usageQuery.data.earlierHeld}`
    : null;
  useEffect(() => {
    if (!usageSignature) return;
    if (lastUsage.current !== null && lastUsage.current !== usageSignature)
      void state.queries.invalidateQueries({
        queryKey: state.key("all-image-tasks"),
      });
    lastUsage.current = usageSignature;
  }, [usageSignature, state]);
  const tasks = [
    ...new Map(
      (tasksQuery.data?.pages.flatMap((page) => page.tasks) ?? []).map(
        (task) => [task.id, task],
      ),
    ).values(),
  ];
  const task = selected
    ? (tasks.find((item) => item.id === selected.id) ?? selected)
    : null;
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      await Promise.all([
        usageQuery.refetch({ throwOnError: true }),
        tasksQuery.refetch({ throwOnError: true }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  async function load() {
    setError("");
    try {
      await tasksQuery.fetchNextPage({ throwOnError: true });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cancel() {
    if (!task || cancelling) return;
    setCancelling(true);
    setActionError("");
    try {
      await api(`/images/tasks/${task.id}/cancel`, {});
      await Promise.all([
        tasksQuery.refetch({ throwOnError: true }),
        usageQuery.refetch({ throwOnError: true }),
      ]);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  }
  return (
    <section className="usage-page">
      <div className="page-heading">
        <h1>我的额度</h1>
        <Tooltip title="刷新">
          <Button
            type="button"
            className="usage-icon-button"
            aria-label="刷新额度"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={17}
              className={refreshing ? "usage-refreshing" : undefined}
            />
          </Button>
        </Tooltip>
      </div>
      {(error || usageQuery.error || tasksQuery.error) && (
        <Notice error>
          {error || usageQuery.error?.message || tasksQuery.error?.message}
        </Notice>
      )}
      {usageQuery.data ? (
        <Overview usage={usageQuery.data} />
      ) : usageQuery.isPending ? (
        <div className="usage-overview">
          <Card loading />
          <Card loading />
        </div>
      ) : null}
      <section className="usage-records" aria-label="使用记录">
        <h2>使用记录</h2>
        <Table<ImageTask>
          rowKey="id"
          dataSource={tasks}
          loading={tasksQuery.isPending}
          pagination={false}
          scroll={{ x: 620 }}
          locale={{ emptyText: "暂无使用记录" }}
          columns={[
            {
              title: "提交时间",
              key: "time",
              width: 240,
              render: (_, item) => taskTime(item.createdAt),
            },
            {
              title: "生成张数",
              key: "used",
              width: 160,
              render: (_, item) => `${item.used} 张`,
            },
            {
              title: "状态",
              key: "state",
              render: (_, item) => <TaskStatus task={item} />,
            },
            {
              title: "",
              key: "details",
              width: 56,
              render: (_, item) => (
                <Tooltip title="查看详情">
                  <Button
                    type="button"
                    className="usage-icon-button"
                    aria-label="查看任务详情"
                    onClick={() => {
                      setActionError("");
                      setSelected(item);
                    }}
                  >
                    <Info size={17} />
                  </Button>
                </Tooltip>
              ),
            },
          ]}
        />
        {tasksQuery.hasNextPage && (
          <div className="usage-load-more">
            <Button
              type="button"
              disabled={tasksQuery.isFetchingNextPage}
              loading={tasksQuery.isFetchingNextPage}
              onClick={() => void load()}
            >
              加载更多记录
            </Button>
          </div>
        )}
      </section>
      <Drawer
        title="任务详情"
        open={!!task}
        size={560}
        destroyOnHidden
        onClose={() => setSelected(null)}
      >
        {task && (
          <div className="usage-task-details">
            <div className="usage-task-heading">
              <TaskStatus task={task} />
              <span>
                {task.used} / {task.count} 张
                {task.held ? ` · ${task.held} 张待结算` : ""}
              </span>
            </div>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "time",
                  label: "提交时间",
                  children: taskTime(task.createdAt),
                },
                { key: "model", label: "图片模型", children: task.model },
                ...(task.settings
                  ? [
                      {
                        key: "size",
                        label: "图片规格",
                        children: `${task.settings.width} × ${task.settings.height} · ${task.settings.format.toUpperCase()}`,
                      },
                    ]
                  : []),
              ]}
            />
            <div>
              <h3>创作需求</h3>
              <p className="usage-task-prompt">{task.prompt || "未填写"}</p>
            </div>
            {task.settings?.style && (
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: "style",
                    label: `风格 · ${task.settings.style.name}`,
                    children: task.settings.style.text,
                  },
                ]}
              />
            )}
            {task.pendingReview && (
              <Notice>结果暂不确定，额度仍在预留，请联系管理员确认。</Notice>
            )}
            {task.errorCode && !task.pendingReview && (
              <Notice error>任务未全部完成，已保存的图片仍可查看。</Notice>
            )}
            {actionError && <Notice error>{actionError}</Notice>}
            {!!task.outputs.length && (
              <div className="usage-result-grid">
                {task.outputs.map((output) => (
                  <figure key={output.id}>
                    {output.deleted ? (
                      <div className="usage-deleted-image">原图已删除</div>
                    ) : (
                      <>
                        <Image
                          src={`/api/images/assets/${output.id}/preview`}
                          alt={`已保存图片，${output.width} × ${output.height}`}
                          preview={{
                            src: `/api/images/assets/${output.id}/original`,
                            motionName: "",
                          }}
                        />
                        <Tooltip title="下载原图">
                          <a
                            className="usage-image-download"
                            aria-label="下载原图"
                            href={`/api/images/assets/${output.id}/download`}
                          >
                            <Download size={16} />
                          </a>
                        </Tooltip>
                      </>
                    )}
                  </figure>
                ))}
              </div>
            )}
            <div className="usage-task-links">
              <Link to="/gallery">
                查看图库 <ArrowUpRight size={14} />
              </Link>
              {["queued", "running"].includes(task.state) && (
                <Tooltip title="已发起的模型调用可能计费">
                  <Button
                    type="button"
                    disabled={cancelling || task.cancelRequested}
                    loading={cancelling}
                    onClick={() => void cancel()}
                  >
                    {task.cancelRequested ? "正在取消…" : "取消任务"}
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
