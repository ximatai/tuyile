import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ModelUsageReport, TokenTotals } from "@tuyile/contracts";
import { Button, Notice, Table, Tabs } from "@tuyile/ui";
import { HelpPopover } from "./interface-help";
import { useSessionState } from "./session-state";
import { client } from "./api";
const number = (n: number) => n.toLocaleString("zh-CN");
const usd = (n: number | null) =>
  n === null ? "—" : n > 0 && n < 0.000001 ? "<$0.000001" : `$${n.toFixed(6)}`;
const columns = [
  { title: "调用", dataIndex: "calls", render: number },
  { title: "输入 token", dataIndex: "inputTokens", render: number },
  { title: "输出 token", dataIndex: "outputTokens", render: number },
  {
    title: "合计 token",
    key: "total",
    render: (_: unknown, r: TokenTotals) =>
      number(r.inputTokens + r.outputTokens),
  },
  {
    title: "缓存输入",
    key: "cached",
    render: (_: unknown, r: TokenTotals) =>
      r.unknownCachedUsage === 0
        ? number(r.cachedInputTokens)
        : r.cachedInputTokens > 0
          ? `${number(r.cachedInputTokens)}（部分）`
          : "—",
  },
  {
    title: "参考费用 USD",
    key: "cost",
    render: (_: unknown, r: TokenTotals) => (
      <>
        {usd(r.referenceUsd)}
        {r.pricedCalls < r.calls && (
          <small className="admin-held">
            {r.calls - r.pricedCalls} 次未估算
          </small>
        )}
      </>
    ),
  },
];
export function TokenUsageAdmin() {
  const state = useSessionState();
  const [period, setPeriod] = useState<"today" | "month">("month");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: state.key("model-token-usage", period, projectId, String(page)),
    queryFn: ({ signal }) =>
      client(state.session.csrfToken)<ModelUsageReport>(
        `/admin/model-usage?period=${period}&offset=${page * 50}${projectId ? `&projectId=${projectId}` : ""}`,
        undefined,
        signal,
      ),
    refetchInterval: 15000,
  });
  const data = query.data;
  return (
    <section>
      <div className="page-heading">
        <h1>用量与费用</h1>
        <HelpPopover title="统计口径">
          上海时间，按每次上游调用开始时间统计，包含重试与格式修复。仅累计服务返回的用量，缺失部分不记为零。费用按调用时保存的OpenAI标准参考价估算，未含缓存写入、服务加价、税费和区域附加费，不等于服务商账单。图片次数额度与token统计独立。
        </HelpPopover>
      </div>
      {projectId && (
        <div className="actions">
          <Button
            type="button"
            onClick={() => {
              setProjectId("");
              setProjectName("");
              setPage(0);
            }}
          >
            全部项目
          </Button>
          <strong>{projectName}</strong>
        </div>
      )}
      {query.error && <Notice error>{query.error.message}</Notice>}
      {data ? (
        <>
          <Table
            rowKey="name"
            pagination={false}
            dataSource={[
              { name: "今日", ...data.today },
              { name: "本月", ...data.thisMonth },
            ]}
            columns={[{ title: "统计范围", dataIndex: "name" }, ...columns]}
          />
          {(data.thisMonth.unknownUsage > 0 ||
            data.thisMonth.unknownCachedUsage > 0) && (
            <p className="hint">
              本月 {data.thisMonth.unknownUsage} 次调用总用量缺失，
              {data.thisMonth.unknownCachedUsage}
              次缓存用量缺失，以上为已记录部分。历史未采集数据无法补算。
            </p>
          )}
          <Tabs
            activeKey={period}
            onChange={(v) => {
              setPeriod(v as "today" | "month");
              setPage(0);
            }}
            items={[
              { key: "today", label: "今日" },
              { key: "month", label: "本月" },
            ]}
          />
          <Table
            rowKey="id"
            pagination={false}
            dataSource={data.projects}
            columns={[
              {
                title: "项目",
                key: "project",
                render: (_, r) => (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => {
                      setProjectId(r.id);
                      setProjectName(r.name);
                      setPage(0);
                    }}
                  >
                    {r.name}
                  </Button>
                ),
              },
              { title: "用户", dataIndex: "username" },
              ...columns,
            ]}
          />
          {(page > 0 || data.hasMore) && (
            <div className="actions">
              <Button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                disabled={!data.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
          <h3>按模型{data.models.length === 100 ? "（调用量前100项）" : ""}</h3>
          <Table
            rowKey={(r) => `${r.kind}-${r.model}`}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            dataSource={data.models}
            columns={[
              { title: "模型", dataIndex: "model" },
              {
                title: "类型",
                dataIndex: "kind",
                render: (v) => (v === "image" ? "生图" : "规划"),
              },
              ...columns,
            ]}
          />
        </>
      ) : (
        !query.error && <p role="status">正在加载用量…</p>
      )}
    </section>
  );
}
