import { useEffect, useId, useRef, useState, type ComponentRef } from "react";
import type { CreationStyle } from "@tuyile/contracts";
import { Pencil } from "lucide-react";
import {
  Button,
  ChoiceField,
  Field,
  Input,
  Popover,
  Tooltip,
  Notice,
  useConfirm,
  useFeedback,
  useControlsDisabled,
} from "@tuyile/ui";
import type { SavedStyle } from "@tuyile/contracts";
import { useQuery } from "@tanstack/react-query";
import { client } from "./api";
import { useSessionState } from "./session-state";
export function StyleSelector({
  style,
  onChange,
  visible = true,
}: {
  style?: CreationStyle;
  onChange: (style: CreationStyle | undefined) => void;
  visible?: boolean;
}) {
  const disabled = useControlsDisabled();
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    confirm = useConfirm(),
    feedback = useFeedback();
  const query = useQuery({
    queryKey: state.key("styles"),
    queryFn: ({ signal }) =>
      api<{ styles: SavedStyle[] }>("/library/styles", undefined, signal),
    refetchInterval: 15000,
  });
  const styles = query.data?.styles ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selectedSnapshot = useRef<CreationStyle | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  const saveId = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<ComponentRef<typeof Button>>(null);
  const descriptionId = useId();
  const [source, setSource] = useState<SavedStyle>();
  const candidate =
    (selectedSnapshot.current?.name === style?.name &&
    selectedSnapshot.current?.text === style?.text
      ? styles.find((p) => p.id === selectedId)
      : undefined) ??
    styles.find((p) => p.name === style?.name && p.text === style?.text);
  const original = open ? source : candidate;
  const exact =
    candidate?.name === style?.name && candidate?.text === style?.text
      ? candidate
      : undefined;
  const current = style ? (exact?.id ?? "modified") : "none";
  async function save(copy: boolean) {
    if (disabled || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api<SavedStyle>("/library/styles", {
        id:
          !copy && original?.scope === "personal"
            ? original.id
            : saveId.current,
        name: name.trim(),
        text: text.trim(),
        revision:
          !copy && original?.scope === "personal" ? original.revision : 0,
        published: false,
      });
      setSelectedId(saved.id);
      selectedSnapshot.current = { name: saved.name, text: saved.text };
      onChange({ name: saved.name, text: saved.text });
      await state.queries.invalidateQueries({ queryKey: state.key("styles") });
      setOpen(false);
      feedback.success("风格已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (
      disabled ||
      !original ||
      original.scope !== "personal" ||
      saving.current ||
      !(await confirm("删除这个个人风格？已有任务和当前创作不受影响。"))
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/library/styles/${original.id}/delete`, {
        revision: original.revision,
      });
      await state.queries.invalidateQueries({ queryKey: state.key("styles") });
      setSelectedId("");
      setOpen(false);
      feedback.success("风格已删除");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!visible || disabled) setOpen(false);
  }, [visible, disabled]);
  function edit(next: boolean) {
    if (disabled || busy) return;
    if (next) {
      setSource(candidate);
      setError("");
      saveId.current = crypto.randomUUID();
      setName(style?.name ?? "自定义风格");
      setText(style?.text ?? "");
    }
    setOpen(next);
  }
  function close() {
    if (busy) return;
    setOpen(false);
    if (style) trigger.current?.focus();
    else
      container.current
        ?.querySelector<HTMLElement>('[role="combobox"]')
        ?.focus();
  }
  function escape(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }
  return (
    <div className="style-selector" ref={container}>
      {query.error && (
        <Notice error>风格暂时无法加载，当前创作内容已保留。</Notice>
      )}
      <ChoiceField
        label="风格"
        value={current}
        disabled={disabled || busy}
        options={[]}
        groups={[
          { value: "none", label: "无风格" },
          {
            label: "公共风格",
            options: styles
              .filter((p) => p.scope === "public")
              .map((p) => ({ value: p.id, label: p.name })),
          },
          {
            label: "我的风格",
            options: styles
              .filter((p) => p.scope === "personal")
              .map((p) => ({ value: p.id, label: p.name })),
          },
          ...(style && !exact
            ? [{ value: "modified", label: `${style.name} · 本次创作` }]
            : []),
          { value: "new", label: "自定义风格" },
        ]}
        onValueChange={(key) => {
          if (disabled) return;
          if (key === "new") {
            setSource(undefined);
            setSelectedId("");
            setError("");
            saveId.current = crypto.randomUUID();
            setName("自定义风格");
            setText("");
            setOpen(true);
            return;
          }
          if (key === "modified") return;
          if (key === "none") {
            setSelectedId("");
            setOpen(false);
            onChange(undefined);
            return;
          }
          const preset = styles.find((p) => p.id === key);
          if (preset) {
            setSelectedId(preset.id);
            selectedSnapshot.current = { name: preset.name, text: preset.text };
            setOpen(false);
            onChange(
              preset.text
                ? { name: preset.name, text: preset.text }
                : undefined,
            );
          }
        }}
      />
      {(style || open) && (
        <Popover
          trigger="click"
          placement="leftTop"
          open={open}
          onOpenChange={edit}
          classNames={{ root: "creation-popover style-editor-popover" }}
          content={
            <div className="style-editor" onKeyDown={escape}>
              <Field
                label="风格名称"
                value={name}
                disabled={disabled || busy}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <label className="field" htmlFor={descriptionId}>
                <span>风格描述</span>
                <Input.TextArea
                  id={descriptionId}
                  aria-label="风格描述"
                  value={text}
                  disabled={disabled || busy}
                  rows={6}
                  maxLength={2000}
                  placeholder="描述画面质感、光线、色彩和构图"
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              {error && <Notice error>{error}</Notice>}
              <div className="style-editor-library-actions">
                {original?.scope === "personal" && (
                  <Button
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => void remove()}
                  >
                    删除
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={disabled || busy || !name.trim() || !text.trim()}
                  onClick={() => void save(original?.scope !== "personal")}
                >
                  {original?.scope === "personal"
                    ? "保存修改"
                    : "保存为我的风格"}
                </Button>
                {original && (
                  <Button
                    type="button"
                    className="style-reset"
                    disabled={
                      disabled ||
                      busy ||
                      (name === original.name && text === original.text)
                    }
                    onClick={() => {
                      setName(original.name);
                      setText(original.text);
                    }}
                  >
                    恢复原风格
                  </Button>
                )}
              </div>
              <div className="style-editor-footer">
                <Button
                  type="button"
                  disabled={disabled || busy}
                  onClick={close}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="primary"
                  disabled={disabled || busy || !name.trim() || !text.trim()}
                  onClick={() => {
                    const next = { name: name.trim(), text: text.trim() };
                    setSelectedId(original?.id ?? "");
                    selectedSnapshot.current = next;
                    onChange(next);
                    close();
                  }}
                >
                  应用
                </Button>
              </div>
            </div>
          }
        >
          <Tooltip
            title={open ? undefined : "编辑风格"}
            trigger={["hover", "focus"]}
          >
            <Button
              ref={trigger}
              type="button"
              className="style-edit-trigger"
              disabled={disabled || busy}
              aria-label="编辑风格"
              aria-expanded={open}
              onKeyDown={escape}
            >
              <Pencil size={16} aria-hidden="true" />
            </Button>
          </Tooltip>
        </Popover>
      )}
    </div>
  );
}
