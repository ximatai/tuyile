import { PublicStylesManager } from "./style-admin";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  promptTemplateInput,
  type PromptTemplateInput,
  type ManagedPromptTemplate,
  type ManagedPromptTemplatesPage,
} from "@tuyile/contracts";
import {
  useFeedback,
  Button,
  Checkbox,
  Drawer,
  Field,
  Input,
  Notice,
  Table,
  Tag,
  useConfirm,
} from "@tuyile/ui";
import { Plus, Search } from "lucide-react";
import { ApiError, client } from "./api";
import { useSessionState } from "./session-state";

export function PromptAdminPage() {
  const feedback = useFeedback();
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    confirm = useConfirm();
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState("");
  const [draft, setDraft] = useState<PromptTemplateInput | null>(null);
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const leave = useRef({ dirty, busy, confirm });
  leave.current = { dirty, busy, confirm };
  useEffect(
    () =>
      state.registerNavigationGuard({
        isDirty: () => leave.current.dirty || leave.current.busy,
        canLeave: () =>
          leave.current.busy
            ? Promise.resolve(false)
            : leave.current.confirm("放弃未保存的提示词修改？"),
      }),
    [state],
  );
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useInfiniteQuery({
    queryKey: state.key("admin-prompts", term),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      api<ManagedPromptTemplatesPage>(
        `/admin/prompts?offset=${pageParam}&search=${encodeURIComponent(term)}`,
        undefined,
        signal,
      ),
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const rows = [
    ...new Map(
      (query.data?.pages.flatMap((p) => p.prompts) ?? []).map((p) => [p.id, p]),
    ).values(),
  ];
  function edit(row?: ManagedPromptTemplate) {
    const value: PromptTemplateInput = row
      ? {
          id: row.id,
          title: row.title,
          category: row.category,
          prompt: row.prompt,
          published: row.published,
          revision: row.revision,
        }
      : {
          id: crypto.randomUUID(),
          title: "",
          category: "",
          prompt: "",
          published: false,
          revision: 0,
        };
    setDraft(value);
    setBaseline(JSON.stringify(value));
    setError("");
  }
  async function close() {
    if (busy || (dirty && !(await confirm("放弃未保存的提示词修改？")))) return;
    setDraft(null);
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || submitting.current) return;
    const parsed = promptTemplateInput.safeParse(draft);
    if (!parsed.success) {
      setError("请填写标题、分类和正文，正文最多 12000 字，不能包含空字符。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api<ManagedPromptTemplate>("/admin/prompts", parsed.data);
      setDraft(null);
      await Promise.all([
        state.queries.invalidateQueries({
          queryKey: state.key("admin-prompts"),
        }),
        state.queries.invalidateQueries({
          queryKey: state.key("prompt-templates"),
        }),
      ]);
      feedback.success("已保存");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败，请重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="prompt-admin-page">
      <div className="page-heading">
        <h1>提示池管理</h1>
        <PublicStylesManager />
        <Link to="/prompts">查看提示池</Link>
      </div>
      <div className="prompt-admin-toolbar">
        <Input
          aria-label="搜索提示词"
          placeholder="搜索标题或分类"
          prefix={<Search size={15} />}
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button className="primary" type="button" onClick={() => edit()}>
          <Plus size={16} />
          新增提示词
        </Button>
      </div>
      {query.error && <Notice error>{query.error.message}</Notice>}
      {!draft && error && <Notice error>{error}</Notice>}
      <Table<ManagedPromptTemplate>
        rowKey="id"
        loading={query.isPending}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: "暂无提示词" }}
        columns={[
          { title: "标题", dataIndex: "title" },
          { title: "分类", dataIndex: "category", width: 160 },
          {
            title: "状态",
            key: "status",
            width: 120,
            render: (_, r) => (
              <Tag color={r.published ? "success" : "default"}>
                {r.published ? "已上架" : "未上架"}
              </Tag>
            ),
          },
          {
            title: "",
            key: "actions",
            width: 80,
            render: (_, r) => (
              <Button type="button" onClick={() => edit(r)}>
                编辑
              </Button>
            ),
          },
        ]}
      />
      {query.hasNextPage && (
        <Button
          type="button"
          loading={query.isFetchingNextPage}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多
        </Button>
      )}
      <Drawer
        title={draft?.revision ? "编辑提示词" : "新增提示词"}
        open={!!draft}
        size={560}
        destroyOnHidden
        maskClosable={!busy}
        keyboard={!busy}
        onClose={() => void close()}
        footer={
          <div className="actions">
            <Button
              className="primary"
              type="submit"
              form="prompt-template-editor"
              loading={busy}
              disabled={busy}
            >
              保存
            </Button>
            <Button type="button" disabled={busy} onClick={() => void close()}>
              取消
            </Button>
          </div>
        }
      >
        {draft && (
          <form id="prompt-template-editor" onSubmit={(e) => void save(e)}>
            {error && <Notice error>{error}</Notice>}
            <Field
              label="标题"
              required
              maxLength={100}
              value={draft.title}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <Field
              label="分类"
              required
              maxLength={60}
              value={draft.category}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
            <div className="field">
              <label htmlFor="prompt-template-body">提示词正文</label>
              <Input.TextArea
                id="prompt-template-body"
                required
                rows={12}
                maxLength={12000}
                showCount
                value={draft.prompt}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              />
            </div>
            <Checkbox
              checked={draft.published}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, published: e.target.checked })
              }
            >
              上架，所有用户可见
            </Checkbox>
          </form>
        )}
      </Drawer>
    </section>
  );
}
