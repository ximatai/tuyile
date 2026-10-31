import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentRef,
  type FormEvent,
} from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, Field, Input, Menu, Modal, Notice, Popover } from "@tuyile/ui";
import type { Project, ProjectsPage } from "@tuyile/contracts";
import { ArrowRight, Plus, Search } from "lucide-react";
import { client } from "./api";
import { useSessionState } from "./session-state";

export function PromptUseMenu({
  disabled,
  onUse,
}: {
  disabled: boolean;
  onUse: (projectId: string) => Promise<boolean>;
}) {
  const formId = useId();
  const state = useSessionState(),
    api = client(state.session.csrfToken);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const trigger = useRef<ComponentRef<typeof Button>>(null),
    pending = useRef(false),
    created = useRef<Project | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const projects = useInfiniteQuery({
    queryKey: state.key("prompt-use-projects", term),
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
    staleTime: 0,
  });
  const rows = [
    ...new Map(
      (projects.data?.pages.flatMap((p) => p.projects) ?? []).map((p) => [
        p.id,
        p,
      ]),
    ).values(),
  ];
  function escape(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }
  async function choose(id: string) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await onUse(id)) setOpen(false);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending.current || disabled) return;
    if (!name.trim()) {
      setError("请输入项目名称。");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!created.current)
        created.current = await api<Project>("/projects", {
          name: name.trim(),
        });
      await Promise.all([
        state.queries.invalidateQueries({ queryKey: state.key("projects") }),
        state.queries.invalidateQueries({
          queryKey: state.key("library-projects"),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("prompt-use-projects"),
        }),
      ]);
      if (await onUse(created.current.id)) {
        setCreating(false);
        created.current = null;
      } else setError("项目已创建，点击继续使用可重试带入提示词。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Popover
        trigger={["hover", "click"]}
        placement="rightTop"
        open={open && !creating}
        onOpenChange={(value) => {
          if (!busy && !disabled) {
            setOpen(value);
            if (value) setError("");
          }
        }}
        mouseEnterDelay={0.15}
        mouseLeaveDelay={0.25}
        classNames={{ root: "prompt-use-popover" }}
        content={
          <div className="prompt-use-content" onKeyDown={escape}>
            <h3>我的项目</h3>
            <Input
              aria-label="搜索我的项目"
              placeholder="搜索项目"
              prefix={<Search size={14} />}
              maxLength={80}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {projects.error && <Notice error>{projects.error.message}</Notice>}
            {projects.isPending && <p role="status">正在加载…</p>}
            <div className="prompt-use-project-list">
              <Menu
                selectable={false}
                aria-label="我的项目"
                items={rows.map((p) => ({
                  key: p.id,
                  label: p.name,
                  disabled: disabled || busy,
                }))}
                onClick={({ key }) => void choose(key)}
              />
              {!projects.isPending && !projects.error && !rows.length && (
                <p className="hint">{term ? "未找到项目" : "暂无项目"}</p>
              )}
              {projects.hasNextPage && (
                <Button
                  type="button"
                  loading={projects.isFetchingNextPage}
                  disabled={busy || projects.isFetchingNextPage}
                  onClick={() => void projects.fetchNextPage()}
                >
                  加载更多项目
                </Button>
              )}
            </div>
            <Button
              className="prompt-use-create"
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                setOpen(false);
                setCreating(true);
                setName("");
                setError("");
                created.current = null;
              }}
            >
              <Plus size={14} />
              新建项目
            </Button>
          </div>
        }
      >
        <Button
          ref={trigger}
          type="button"
          aria-label="使用提示词"
          aria-expanded={open}
          disabled={disabled || busy}
          onKeyDown={(event) => {
            escape(event);
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          使用 <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </Popover>
      <Modal
        title="新建项目"
        open={creating}
        destroyOnHidden
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
        onCancel={() => {
          if (!busy) setCreating(false);
        }}
        footer={
          <div className="actions">
            <Button
              className="primary"
              type="submit"
              form={formId}
              loading={busy}
              disabled={busy}
            >
              {created.current ? "继续使用" : "创建并使用"}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              取消
            </Button>
          </div>
        }
      >
        <form id={formId} onSubmit={(e) => void create(e)}>
          {error && <Notice error>{error}</Notice>}
          <Field
            label="项目名称"
            autoFocus
            required
            maxLength={80}
            disabled={busy || !!created.current}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </form>
      </Modal>
    </>
  );
}
