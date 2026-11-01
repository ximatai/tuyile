import { ArrowUp, ArrowDown, X, ChevronDown, ChevronUp } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { TextSource } from "@tuyile/contracts";
import { composeCreativePrompt } from "@tuyile/contracts";
import { Button, Checkbox, Collapse, Modal, Notice, Tooltip } from "@tuyile/ui";
import { useProjectDraft } from "./project-draft";
import type { EditorStore } from "./editor/store";
const Context = createContext<{
  store?: EditorStore;
  register: (store: EditorStore) => void;
}>({ register: () => {} });
export function TextCanvasBoundary({ children }: { children: ReactNode }) {
  const [store, register] = useState<EditorStore>();
  return (
    <Context.Provider value={{ store, register }}>{children}</Context.Provider>
  );
}
const empty: Pick<
  import("./editor/store").EditorState,
  "document" | "selected"
> = {
  document: { schemaVersion: 1, nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
  selected: [],
};
const noop = () => () => {};
const noIds: string[] = [];
export function useTextReferences() {
  const { store, register } = useContext(Context);
  const canvas = useSyncExternalStore<
    Pick<import("./editor/store").EditorState, "document" | "selected">
  >(store?.subscribe ?? noop, store?.get ?? (() => empty));
  const draft = useProjectDraft();
  const snapshot = useSyncExternalStore(draft.subscribe, draft.get);
  const ids = snapshot.document.textNodeIds ?? noIds;
  const nodes = canvas.document.nodes.filter((n) => n.kind === "text");
  const sources: TextSource[] = ids.flatMap((id) => {
    const n = nodes.find((n) => n.id === id);
    return n ? [{ nodeId: id, title: n.label, text: n.text ?? "" }] : [];
  });
  const issue = ids.some(
    (id) => !nodes.some((n) => n.id === id && n.text?.trim()),
  )
    ? "引用文案已删除或内容为空，请补充内容或移除引用。"
    : "";
  function setIds(next: string[]) {
    draft.edit({ textNodeIds: next });
  }
  function link(id: string) {
    if (ids.includes(id)) return;
    if (ids.length >= 8)
      throw new Error("最多引用 8 条文案，请先移除部分引用。");
    setIds([...ids, id]);
  }
  async function flush() {
    if (!store) throw new Error("画布尚未加载，请稍后再提交。");
    await store.flush();
  }
  return { store, register, nodes, ids, sources, issue, setIds, link, flush };
}
export function TextReferences({
  disabled = false,
  visible = true,
  prompt,
  style,
}: {
  disabled?: boolean;
  visible?: boolean;
  prompt: string;
  style?: import("@tuyile/contracts").CreationStyle;
}) {
  const refs = useTextReferences();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  function show() {
    setSelection(refs.ids);
    setOpen(true);
  }
  return (
    <section className="text-references" aria-label="引用文案">
      <div className="text-reference-heading">
        <strong>
          引用文案{refs.ids.length ? ` · ${refs.ids.length}` : ""}
        </strong>
        <Button type="button" disabled={disabled || !refs.store} onClick={show}>
          从画布选择
        </Button>
      </div>
      {refs.ids.map((id, i) => {
        const node = refs.nodes.find((n) => n.id === id);
        return (
          <div className="text-reference-item" key={id}>
            <div className="text-reference-row">
              <Button
                className="text-reference-title"
                type="button"
                disabled={!node}
                onClick={() => {
                  refs.store?.select([id]);
                  if (node)
                    refs.store?.edit(
                      {
                        ...refs.store.get().document,
                        viewport: {
                          zoom: 1,
                          x: Math.max(-100000, Math.min(100000, 60 - node.x)),
                          y: Math.max(-100000, Math.min(100000, 70 - node.y)),
                        },
                      },
                      false,
                    );
                }}
              >
                {node ? node.label || "未命名文案" : "文案已删除"}
              </Button>
              <Tooltip title={expanded.includes(id) ? "收起全文" : "展开全文"}>
                <Button
                  className="text-reference-expand"
                  type="button"
                  aria-label={`${expanded.includes(id) ? "收起" : "展开"}文案 ${i + 1}`}
                  aria-expanded={expanded.includes(id)}
                  onClick={() =>
                    setExpanded((old) =>
                      old.includes(id)
                        ? old.filter((item) => item !== id)
                        : [...old, id],
                    )
                  }
                >
                  {expanded.includes(id) ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </Button>
              </Tooltip>
            </div>
            <p
              className={
                expanded.includes(id)
                  ? "text-reference-full"
                  : "text-reference-summary"
              }
            >
              {expanded.includes(id)
                ? node?.text || "内容为空"
                : node?.text?.slice(0, 100) || "内容为空"}
            </p>
            <div className="text-reference-actions">
              <Button
                type="button"
                disabled={disabled || i === 0}
                onClick={() => {
                  const next = [...refs.ids];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  refs.setIds(next);
                }}
                aria-label={`上移文案 ${i + 1}`}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                type="button"
                disabled={disabled || i === refs.ids.length - 1}
                onClick={() => {
                  const next = [...refs.ids];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  refs.setIds(next);
                }}
                aria-label={`下移文案 ${i + 1}`}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                type="button"
                disabled={disabled}
                onClick={() => refs.setIds(refs.ids.filter((n) => n !== id))}
                aria-label={`移除文案 ${i + 1}`}
              >
                <X size={14} />
              </Button>
            </div>
          </div>
        );
      })}
      {refs.issue && <Notice error>{refs.issue}</Notice>}
      {!!refs.ids.length && (
        <Collapse
          items={[
            {
              key: "preview",
              label: "查看组合后的创作需求",
              children: (
                <p className="text-prompt-preview">
                  {composeCreativePrompt({
                    prompt,
                    style,
                    textSources: refs.sources,
                  })}
                </p>
              ),
            },
          ]}
        />
      )}
      <Modal
        title="从画布选择文案"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => {
          refs.setIds(selection);
          setOpen(false);
        }}
        okButtonProps={{ disabled: disabled || selection.length > 8 }}
      >
        <p>最多引用 8 条，顺序即提交顺序。仅选中的文案会发送给模型。</p>
        {!refs.nodes.length && <p>请先在画布中添加文本。</p>}
        {refs.nodes.map((n) => (
          <div className="text-picker-item" key={n.id}>
            <Checkbox
              checked={selection.includes(n.id)}
              disabled={
                disabled || (!selection.includes(n.id) && selection.length >= 8)
              }
              onChange={(e) =>
                setSelection(
                  e.target.checked
                    ? [...selection, n.id]
                    : selection.filter((id) => id !== n.id),
                )
              }
            >
              {n.label || "未命名文案"}
            </Checkbox>
            <p>{n.text?.slice(0, 150) || "内容为空"}</p>
          </div>
        ))}
      </Modal>
    </section>
  );
}
