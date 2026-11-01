import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
  DemoImage,
  ProjectDemo,
  DemoStatus,
  DemoTemplateInfo,
  ProjectsPage,
} from "@tuyile/contracts";
import {
  Button,
  Modal,
  Descriptions,
  Notice,
  Select,
  useConfirm,
  useFeedback,
} from "@tuyile/ui";
import { client } from "./api";
import { useSessionState } from "./session-state";
export function DemoImageDetails({
  image,
  onClose,
}: {
  image: DemoImage | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title={image ? `${image.label} · 示例创作信息` : ""}
      open={!!image}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      {image && (
        <>
          <p className="hint">
            来自内置示例模板，非本账号执行的生成任务，不计入本账号生成次数。
          </p>
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: "model", label: "原示例模型", children: image.model },
              {
                key: "size",
                label: "原示例规格",
                children: `${image.settings.width} × ${image.settings.height} · ${image.settings.quality} · ${image.settings.format.toUpperCase()}`,
              },
            ]}
          />
          <h3>示例提示词</h3>
          <p className="task-detail-prompt">{image.prompt}</p>
          {!!image.sourceIds.length && (
            <>
              <h3>示例参考图</h3>
              <div className="demo-reference-previews">
                {image.sourceIds.map((id) => (
                  <img
                    key={id}
                    src={`/api/images/assets/${id}/preview`}
                    alt="示例参考图"
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
export function DemoRecords({
  demo,
}: {
  demo: ProjectDemo | null | undefined;
}) {
  const [selected, setSelected] = useState<DemoImage | null>(null);
  if (!demo) return null;
  return (
    <section className="demo-records" aria-label="示例创作记录">
      <h3>示例创作记录</h3>
      <p className="hint">来自模板 · 未调用模型 · 不计入生成次数</p>
      <div className="demo-record-grid">
        {demo.images.map((i) => (
          <article key={i.assetId}>
            <img
              src={`/api/images/assets/${i.assetId}/preview`}
              alt={i.label}
            />
            <strong>{i.label}</strong>
            <Button type="button" onClick={() => setSelected(i)}>
              查看示例提示词
            </Button>
          </article>
        ))}
      </div>
      <DemoImageDetails image={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
export function DemoRetry({ userId }: { userId?: string }) {
  const s = useSessionState(),
    api = client(s.session.csrfToken),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = userId ? `/admin/users/${userId}/demo` : "/onboarding/demo";
  const q = useQuery({
    queryKey: s.key("demo-status", userId ?? "self"),
    queryFn: ({ signal }) => api<DemoStatus>(path, undefined, signal),
  });
  if (q.data?.state !== "failed" && q.data?.state !== "pending") return null;
  return (
    <Notice error>
      <span>示例项目尚未准备完成。</span>
      <Button
        type="button"
        loading={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void api<DemoStatus>(path, {})
            .then(async (result) => {
              await q.refetch();
              await s.queries.invalidateQueries({
                queryKey: s.key("projects"),
              });
              if (!userId && result.state === "ready" && result.projectId)
                location.assign(`/projects/${result.projectId}`);
              else if (result.state === "failed")
                setError("初始化未完成，请稍后重试。");
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        重试示例初始化
      </Button>
      {error && <span>{error}</span>}
    </Notice>
  );
}
export function DemoTemplateManager() {
  const s = useSessionState(),
    api = client(s.session.csrfToken),
    confirm = useConfirm(),
    feedback = useFeedback();
  const [open, setOpen] = useState(false),
    [projectId, setProjectId] = useState<string>(),
    [projectLabel, setProjectLabel] = useState(""),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = useQuery({
    queryKey: s.key("demo-template"),
    queryFn: ({ signal }) =>
      api<DemoTemplateInfo | null>("/admin/demo-template", undefined, signal),
    enabled: open,
  });
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const projects = useInfiniteQuery({
    queryKey: s.key("demo-template-projects", term),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<ProjectsPage>(
        `/projects?offset=${pageParam}&search=${encodeURIComponent(term)}`,
        undefined,
        signal,
      ),
    getNextPageParam: (page, pages) =>
      page.hasMore ? pages.length * 50 : undefined,
    enabled: open,
  });
  const options = [
    ...new Map(
      (projects.data?.pages.flatMap((p) => p.projects) ?? []).map((p) => [
        p.id,
        { value: p.id, label: p.name },
      ]),
    ).values(),
  ];
  if (projectId && !options.some((p) => p.value === projectId))
    options.unshift({ value: projectId, label: projectLabel });
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        新用户示例
      </Button>
      <Modal
        title="新用户示例"
        open={open}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        footer={null}
        destroyOnHidden
      >
        <p>当前模板：{q.data?.name ?? "尚未发布"}</p>
        <p className="hint">
          选择含三张成功图片及 A＋B → C
          来源关系的项目。发布后仅用于之后新增的用户，不覆盖已有副本；失败和待核验任务不会复制。
        </p>
        <Select
          aria-label="示例来源项目"
          showSearch={{ filterOption: false, onSearch: setSearch }}
          loading={projects.isFetching}
          onPopupScroll={(event) => {
            const element = event.currentTarget;
            if (
              element.scrollHeight - element.scrollTop - element.clientHeight <
                32 &&
              projects.hasNextPage &&
              !projects.isFetching
            )
              void projects.fetchNextPage();
          }}
          value={projectId}
          onChange={(value, option) => {
            setProjectId(value);
            setProjectLabel(
              !Array.isArray(option) ? (option?.label ?? "") : "",
            );
          }}
          options={options}
          placeholder="选择项目"
          disabled={busy}
        />
        {(error || q.error || projects.error) && (
          <Notice error>
            {error || q.error?.message || projects.error?.message}
          </Notice>
        )}
        <Button
          type="button"
          className="primary"
          disabled={!projectId || busy}
          loading={busy}
          onClick={() =>
            void (async () => {
              if (
                !(await confirm(
                  "将这个项目的成功图片、示例提示词和当前起始草稿发布为新用户示例？",
                ))
              )
                return;
              setBusy(true);
              setError("");
              try {
                await api("/admin/demo-template", {
                  projectId,
                  requestKey: crypto.randomUUID(),
                });
                await q.refetch();
                feedback.success("新用户示例已发布");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          发布示例模板
        </Button>
      </Modal>
    </>
  );
}
