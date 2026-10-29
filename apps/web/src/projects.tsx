import { useEffect, useState, type FormEvent } from "react";
import { Folder, Plus, ArrowLeft } from "lucide-react";
import type {
  Project,
  ProjectsPage as ProjectPageResponse,
} from "@tuyile/contracts";
import { Button, Field, Notice } from "@tuyile/ui";
import { client } from "./api";
export function ProjectsPage({ csrfToken }: { csrfToken: string }) {
  const [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState<Project | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false),
    [offset, setOffset] = useState(50);
  const selectedId = location.pathname.match(/^\/projects\/([^/]+)$/)?.[1];
  useEffect(() => {
    const c = new AbortController();
    const api = client(csrfToken);
    void (async () => {
      try {
        if (selectedId)
          setSelected(
            await api<Project>(
              `/projects/${encodeURIComponent(selectedId)}`,
              undefined,
              c.signal,
            ),
          );
        else {
          const page = await api<ProjectPageResponse>(
            "/projects",
            undefined,
            c.signal,
          );
          if (!c.signal.aborted) {
            setProjects(page.projects);
            setHasMore(page.hasMore);
            setOffset(50);
          }
        }
      } catch (e) {
        if (!c.signal.aborted) setError((e as Error).message);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [csrfToken, selectedId]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const p = await client(csrfToken)<Project>("/projects", {
        name: new FormData(form).get("name"),
      });
      setProjects((old) => [p, ...old]);
      setOffset((v) => v + 1);
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    setError("");
    try {
      const page = await client(csrfToken)<ProjectPageResponse>(
        `/projects?offset=${offset}`,
      );
      setProjects((old) => [
        ...new Map([...old, ...page.projects].map((p) => [p.id, p])).values(),
      ]);
      setOffset((v) => v + 50);
      setHasMore(page.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (selectedId)
    return (
      <section>
        <a className="back" href="/projects">
          <ArrowLeft size={16} />
          返回项目
        </a>
        {loading ? (
          <p role="status">正在加载项目…</p>
        ) : selected ? (
          <>
            <p className="eyebrow">个人项目</p>
            <h1>{selected.name}</h1>
            <p className="muted">
              创建于 {new Date(selected.createdAt).toLocaleString("zh-CN")}
            </p>
            <dl className="detail">
              <dt>归属</dt>
              <dd>你的个人工作区</dd>
              <dt>项目标识</dt>
              <dd>{selected.id}</dd>
            </dl>
          </>
        ) : null}
        {error && <Notice error>{error}</Notice>}
      </section>
    );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">个人工作区</p>
          <h1>我的项目</h1>
          <p className="muted">按创作主题整理你的项目，内容仅自己可见。</p>
        </div>
        <span className="count">已显示 {projects.length} 个项目</span>
      </div>
      <form className="create-project" onSubmit={create} aria-label="创建项目">
        <Field
          label="项目名称"
          name="name"
          placeholder="例如：秋日品牌视觉"
          required
          maxLength={80}
        />
        <Button className="primary" disabled={busy}>
          <Plus size={17} />
          {busy ? "正在创建…" : "创建项目"}
        </Button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {loading ? (
        <p role="status">正在加载项目…</p>
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((p) => (
            <a className="project-card" href={`/projects/${p.id}`} key={p.id}>
              <Folder size={24} />
              <h2>{p.name}</h2>
              <span className="hint">
                {new Date(p.createdAt).toLocaleDateString("zh-CN")} 创建
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Folder size={32} />
          <h2>从第一个项目开始</h2>
          <p>给项目起个名字，把一次创作整理在一起。</p>
        </div>
      )}
      {hasMore && (
        <Button disabled={busy} onClick={() => void more()}>
          {busy ? "正在加载…" : "加载更多项目"}
        </Button>
      )}
    </section>
  );
}
