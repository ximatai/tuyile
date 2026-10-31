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
import { client } from "./api";
import { useSessionState } from "./session-state";
export function PublicStylesManager() {
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    confirm = useConfirm(),
    feedback = useFeedback();
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<StyleInput | null>(null),
    [baseline, setBaseline] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const query = useQuery({
    queryKey: state.key("admin-styles"),
    queryFn: ({ signal }) =>
      api<{ styles: SavedStyle[] }>("/admin/styles", undefined, signal),
    enabled: open,
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
  async function back(close = false) {
    if (busy || (dirty && !(await confirm("放弃未保存的风格修改？")))) return;
    setDraft(null);
    setError("");
    if (close) setOpen(false);
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
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        管理公共风格
      </Button>
      <Drawer
        title="公共风格"
        open={open}
        size={640}
        onClose={() => void back(true)}
        destroyOnHidden
      >
        {draft ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
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
            {error && <Notice error>{error}</Notice>}
            <div className="style-editor-footer">
              <Button type="button" disabled={busy} onClick={() => void back()}>
                返回
              </Button>
              <Button disabled={busy} className="primary">
                保存风格
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Button type="button" onClick={() => edit()}>
              新增风格
            </Button>
            {query.error && <Notice error>{query.error.message}</Notice>}
            <Table<SavedStyle>
              rowKey="id"
              loading={query.isPending}
              dataSource={query.data?.styles ?? []}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: "名称", dataIndex: "name" },
                {
                  title: "状态",
                  render: (_, row) => (
                    <Tag>{row.published ? "已上架" : "未上架"}</Tag>
                  ),
                },
                {
                  title: "",
                  render: (_, row) => (
                    <Button type="button" onClick={() => edit(row)}>
                      编辑
                    </Button>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </>
  );
}
