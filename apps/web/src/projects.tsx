import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "react-router-dom";
import type {
  Project,
  ProjectsPage as ProjectPageResponse,
} from "@tuyile/contracts";
import { Button, Field, Notice, useConfirm } from "@tuyile/ui";
import { useSessionState } from "./session-state";
import { client } from "./api";
import { lazy, Suspense } from "react";
const CreationPage = lazy(() =>
  import("./creation").then((m) => ({ default: m.CreationPage })),
);
export function ProjectsPage({ csrfToken }: { csrfToken: string }) {
  const state = useSessionState();
  const confirm = useConfirm();
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
    setBusy(true);
    setError("");
    try {
      await client(csrfToken)("/projects", { name });
      setName("");
      await state.queries.invalidateQueries({
        queryKey: state.key("projects"),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeProject(project: Project) {
    if (
      !(await confirm(
        `删除项目“${project.name}”？画布与对话会清除，图库原件保留。活动或待核验任务会阻止删除。`,
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await state.flush();
      await client(csrfToken)(`/projects/${project.id}/delete`, {});
      state.editors.get(project.id)?.dispose();
      state.editors.delete(project.id);
      state.creationDrafts.delete(project.id);
      await state.queries.invalidateQueries({ queryKey: state.key() });
    } catch (e) {
      setError((e as Error).message);
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
      </div>
      <form className="create-project" onSubmit={create} aria-label="创建项目">
        <Field
          label="项目名称"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
        />
        <Button className="primary" disabled={busy}>
          创建项目
        </Button>
      </form>
      {(error || query.error) && (
        <Notice error>{error || query.error?.message}</Notice>
      )}
      {query.isPending ? (
        <p role="status">正在加载项目…</p>
      ) : (
        <div className="project-grid">
          {query.data?.projects.map((p) => (
            <div className="project-card-shell" key={p.id}>
              <Link className="project-card" to={`/projects/${p.id}`}>
                <h2>{p.name}</h2>
                <span className="hint">
                  {new Date(p.createdAt).toLocaleDateString("zh-CN")} 创建
                </span>
              </Link>
              <Button
                disabled={busy}
                aria-label={`删除项目 ${p.name}`}
                onClick={() => void removeProject(p)}
              >
                删除项目
              </Button>
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
  if (!query.data) return <p role="status">正在加载项目…</p>;
  return (
    <section className="project-workspace">
      <Suspense fallback={<p role="status">正在加载创作面板…</p>}>
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
      <Link to="/projects">返回项目</Link>
      <h1>{query.data?.name ?? "项目画布"}</h1>
    </span>
  );
}
