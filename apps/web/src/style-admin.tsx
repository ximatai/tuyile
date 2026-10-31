import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SavedStyle, StyleInput } from "@tuyile/contracts";
import {
  Button,
  Drawer,
  Field,
  Input,
  Checkbox,
  Notice,
  Table,
  Tag,
  useConfirm,
  useFeedback,
} from "@tuyile/ui";
import { Plus, Search } from "lucide-react";
import { client } from "./api";
import { useSessionState } from "./session-state";
export function PublicStylesManager() {
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    confirm = useConfirm(),
    feedback = useFeedback();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<StyleInput | null>(null),
    [baseline, setBaseline] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const query = useQuery({
    queryKey: state.key("admin-styles"),
    queryFn: ({ signal }) =>
      api<{ styles: SavedStyle[] }>("/admin/styles", undefined, signal),
  });
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const leave = useRef({ dirty, busy });
  leave.current = { dirty, busy };
  useEffect(
    () =>
      state.registerNavigationGuard({
        isDirty: () => leave.current.dirty || leave.current.busy,
        canLeave: () =>
          leave.current.busy
            ? Promise.resolve(false)
            : confirm("放弃未保存的风格修改？"),
      }),
    [state],
  );
  function edit(row?: SavedStyle) {
    const next = row
      ? {
          id: row.id,
          name: row.name,
          text: row.text,
          published: row.published,
          revision: row.revision,
        }
      : {
          id: crypto.randomUUID(),
          name: "",
          text: "",
          published: false,
          revision: 0,
        };
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError("");
  }
  async function back() {
    if (busy || (dirty && !(await confirm("放弃未保存的风格修改？")))) return;
    setDraft(null);
    setError("");
  }
  async function save() {
    if (!draft || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/admin/styles", draft);
      await Promise.all([
        state.queries.invalidateQueries({
          queryKey: state.key("admin-styles"),
        }),
        state.queries.invalidateQueries({ queryKey: state.key("styles") }),
      ]);
      setDraft(null);
      feedback.success("风格已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const rows = (query.data?.styles ?? []).filter(
    (row) =>
      !search.trim() ||
      `${row.name} ${row.text}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="public-style-manager">
      <div className="prompt-admin-toolbar">
        <Input
          aria-label="搜索风格"
          placeholder="搜索名称或描述"
          prefix={<Search size={15} />}
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="button" className="primary" onClick={() => edit()}>
          <Plus size={16} />
          新增风格
        </Button>
      </div>
      {query.error && <Notice error>{query.error.message}</Notice>}
      <Table<SavedStyle>
        rowKey="id"
        loading={query.isPending}
        dataSource={rows}
        pagination={{
          pageSize: 10,
          showSizeChanger: false,
          hideOnSinglePage: true,
        }}
        locale={{ emptyText: "暂无风格" }}
        columns={[
          { title: "名称", dataIndex: "name", width: 180 },
          { title: "描述", dataIndex: "text", ellipsis: true },
          {
            title: "状态",
            width: 120,
            render: (_, row) => (
              <Tag color={row.published ? "success" : "default"}>
                {row.published ? "已上架" : "未上架"}
              </Tag>
            ),
          },
          {
            title: "",
            width: 80,
            render: (_, row) => (
              <Button type="button" onClick={() => edit(row)}>
                编辑
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title={draft?.revision ? "编辑风格" : "新增风格"}
        open={!!draft}
        size={560}
        onClose={() => void back()}
        destroyOnHidden
        maskClosable={!busy}
        keyboard={!busy}
        footer={
          <div className="actions">
            <Button
              className="primary"
              type="submit"
              form="public-style-editor"
              loading={busy}
              disabled={busy}
            >
              保存风格
            </Button>
            <Button type="button" disabled={busy} onClick={() => void back()}>
              取消
            </Button>
          </div>
        }
      >
        {draft && (
          <form
            id="public-style-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {error && <Notice error>{error}</Notice>}
            <Field
              label="风格名称"
              value={draft.name}
              maxLength={80}
              required
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <label className="field">
              <span>风格描述</span>
              <Input.TextArea
                aria-label="风格描述"
                value={draft.text}
                rows={8}
                maxLength={2000}
                required
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </label>
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
    </div>
  );
}
