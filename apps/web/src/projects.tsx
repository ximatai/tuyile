import { Ellipsis, Plus, Images } from "lucide-react";
import { DemoRetry } from "./demo";
import { LoadingState } from "./loading-state";
import { useState, useRef, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "react-router-dom";
import type {
  Project,
  ProjectsPage as ProjectPageResponse,
} from "@tuyile/contracts";
import {
  useFeedback,
  Button,
  Field,
  Notice,
  Modal,
  Dropdown,
} from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { lazy, Suspense } from "react";
const CreationPage = lazy(() =>
  import("./creation").then((m) => ({ default: m.CreationPage })),
);
function ProjectCover({ assetIds }: { assetIds: string[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const visible = assetIds.filter((id) => !failed.includes(id)).slice(0, 3);
  return (
    <div
      className={`project-cover project-cover-count-${visible.length}`}
      aria-hidden="true"
    >
      {visible.length ? (
        visible.map((id, index) => (
          <img
            key={id}
            className={`project-cover-layer project-cover-depth-${index}`}
            src={`/api/images/assets/${id}/preview`}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed((old) => [...old, id])}
          />
        ))
      ) : (
        <Images size={36} strokeWidth={1.25} />
      )}
    </div>
  );
}
export function ProjectsPage({ csrfToken }: { csrfToken: string }) {
  const feedback = useFeedback();
  const state = useSessionState();
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const menuTriggers = useRef(new Map<string, HTMLElement>());
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [limit, setLimit] = useState(50);
  const query = useQuery({
    queryKey: state.key("projects", String(limit)),
    queryFn: async ({ signal }) => {
      const pages: ProjectPageResponse[] = [];
      for (let offset = 0; offset < limit; offset += 50)
        pages.push(
          await client(csrfToken)<ProjectPageResponse>(
            `/projects?offset=${offset}`,
            undefined,
            signal,
          ),
        );
      return {
        projects: pages.flatMap((p) => p.projects),
        hasMore: pages.at(-1)?.hasMore,
      };
    },
  });
  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await client(csrfToken)("/projects", { name });
      setName("");
      setCreateOpen(false);
      await state.queries.invalidateQueries({
        queryKey: state.key("projects"),
      });
      feedback.success("项目已创建");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeProject(project: Project) {
    setBusy(true);
    setError("");
    try {
      await state.flush();
      await client(csrfToken)(`/projects/${project.id}/delete`, {});
      state.releaseProject(project.id);
      await state.queries.invalidateQueries({ queryKey: state.key() });
      feedback.success("项目已删除");
    } catch (e) {
      feedback.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>我的项目</h1>
        </div>
        <Button
          type="button"
          className="primary"
          onClick={() => {
            setError("");
            setCreateOpen(true);
          }}
        >
          <Plus size={16} />
          新建项目
        </Button>
      </div>
      <DemoRetry />
      <Modal
        title="请确认"
        open={deleteOpen}
        okText="确认"
        cancelText="取消"
        confirmLoading={busy}
        closable={!busy}
        keyboard={!busy}
        mask={{ closable: false }}
        focusable={{ focusTriggerAfterClose: false }}
        onOk={async () => {
          if (busy || !deleteTarget) return;
          await removeProject(deleteTarget);
          setDeleteOpen(false);
        }}
        onCancel={() => {
          if (!busy) setDeleteOpen(false);
        }}
        afterClose={() => {
          if (deleteTarget) menuTriggers.current.get(deleteTarget.id)?.focus();
          setDeleteTarget(null);
        }}
      >
        删除项目“{deleteTarget?.name}
        ”？画布与对话会清除，图库原件保留。活动或待核验任务会阻止删除。
      </Modal>
      <Modal
        title="新建项目"
        open={createOpen}
        footer={null}
        width={400}
        destroyOnHidden
        mask={{ closable: false }}
        closable={!busy}
        keyboard={!busy}
        onCancel={() => {
          if (!busy) {
            setCreateOpen(false);
            setError("");
            setName("");
          }
        }}
      >
        <form
          className="create-project"
          onSubmit={create}
          aria-label="创建项目"
        >
          <Field
            label="项目名称"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            autoFocus
          />
          <Button className="primary" disabled={busy}>
            创建项目
          </Button>
          {error && <Notice error>{error}</Notice>}
        </form>
      </Modal>
      {query.error && <Notice error>{query.error.message}</Notice>}
      {query.isPending ? (
        <LoadingState />
      ) : (
        <div className="project-grid">
          {query.data?.projects.map((p) => (
            <div className="project-card-shell" key={p.id}>
              <Link className="project-card" to={`/projects/${p.id}`}>
                <ProjectCover assetIds={p.coverAssetIds ?? []} />
                <div className="project-card-caption">
                  <h2 title={p.name}>{p.name}</h2>
                  <span className="hint">
                    {new Date(p.createdAt).toLocaleDateString("zh-CN")} 创建
                  </span>
                </div>
              </Link>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "delete",
                      label: "删除项目",
                      danger: true,
                      disabled: busy,
                    },
                  ],
                  onClick: () => {
                    setDeleteTarget(p);
                    setDeleteOpen(true);
                  },
                }}
              >
                <Button
                  type="button"
                  className="project-card-menu"
                  ref={(element) => {
                    if (element) menuTriggers.current.set(p.id, element);
                    else menuTriggers.current.delete(p.id);
                  }}
                  aria-label={`项目操作 ${p.name}`}
                  disabled={busy}
                >
                  <Ellipsis size={18} />
                </Button>
              </Dropdown>
            </div>
          ))}
        </div>
      )}
      {!query.isPending && query.data?.projects.length === 0 && (
        <div className="empty">
          <h2>从第一个项目开始</h2>
          <p>给项目起个名字，把一次创作整理在一起。</p>
        </div>
      )}
      {query.data?.hasMore && (
        <Button onClick={() => setLimit((v) => v + 50)}>加载更多项目</Button>
      )}
    </section>
  );
}
export function ProjectWorkspace({ csrfToken }: { csrfToken: string }) {
  const { projectId } = useParams();
  const state = useSessionState();
  const query = useQuery({
    queryKey: state.key("project", projectId!),
    queryFn: ({ signal }) =>
      client(csrfToken)<Project>(`/projects/${projectId}`, undefined, signal),
  });
  if (query.error) return <Notice error>{query.error.message}</Notice>;
  if (!query.data) return <LoadingState variant="workspace" />;
  return (
    <section className="project-workspace">
      <Suspense fallback={<LoadingState variant="workspace" />}>
        <CreationPage
          key={projectId}
          csrfToken={csrfToken}
          projectId={projectId!}
        />
      </Suspense>
    </section>
  );
}
export function ProjectNavigation() {
  const state = useSessionState();
  const query = useQuery({
    queryKey: state.key("projects", "50"),
    queryFn: ({ signal }) =>
      client(state.session.csrfToken)<ProjectPageResponse>(
        "/projects",
        undefined,
        signal,
      ),
  });
  const location = useLocation();
  return (
    <div className="sidebar-projects">
      <small>我的项目</small>
      {query.data?.projects.map((p) => (
        <Link
          to={`/projects/${p.id}`}
          key={p.id}
          title={p.name}
          aria-current={
            location.pathname === `/projects/${p.id}` ? "page" : undefined
          }
        >
          {p.name}
        </Link>
      ))}
    </div>
  );
}

export function ProjectHeading() {
  const state = useSessionState(),
    projectId = useLocation().pathname.split("/")[2];
  const query = useQuery({
    queryKey: state.key("project", projectId),
    queryFn: ({ signal }) =>
      client(state.session.csrfToken)<Project>(
        `/projects/${projectId}`,
        undefined,
        signal,
      ),
  });
  return (
    <span className="workspace-title">
      <h1>{query.data?.name ?? "项目画布"}</h1>
    </span>
  );
}
