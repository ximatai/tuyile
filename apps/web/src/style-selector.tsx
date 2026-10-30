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
} from "@tuyile/ui";
import { stylePresets } from "./creation-presets";
export function StyleSelector({
  style,
  onChange,
  visible = true,
}: {
  style?: CreationStyle;
  onChange: (style: CreationStyle | undefined) => void;
  visible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<ComponentRef<typeof Button>>(null);
  const descriptionId = useId();
  const original = stylePresets.find((p) => p.text && p.label === style?.name);
  const exact = original?.text === style?.text ? original : undefined;
  const current = style ? (exact?.id ?? "modified") : "none";
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  function edit(next: boolean) {
    if (next) {
      setName(style?.name ?? "自定义风格");
      setText(style?.text ?? "");
    }
    setOpen(next);
  }
  function close() {
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
      <ChoiceField
        label="风格"
        value={current}
        options={[
          ...stylePresets.map((p) => ({ value: p.id, label: p.label })),
          ...(style && !exact
            ? [
                {
                  value: "modified",
                  label: `${style.name}${original ? " · 已修改" : ""}`,
                },
              ]
            : []),
          ...(style?.name !== "自定义风格"
            ? [{ value: "new", label: "自定义风格" }]
            : []),
        ]}
        onValueChange={(key) => {
          if (key === "new") {
            setName("自定义风格");
            setText("");
            setOpen(true);
            return;
          }
          if (key === "modified") return;
          const preset = stylePresets.find((p) => p.id === key);
          if (preset) {
            setOpen(false);
            onChange(
              preset.text
                ? { name: preset.label, text: preset.text }
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
          classNames={{ root: "style-editor-popover" }}
          content={
            <div className="style-editor" onKeyDown={escape}>
              <Field
                label="风格名称"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <label className="field" htmlFor={descriptionId}>
                <span>风格描述</span>
                <Input.TextArea
                  id={descriptionId}
                  aria-label="风格描述"
                  value={text}
                  rows={6}
                  maxLength={2000}
                  placeholder="描述画面质感、光线、色彩和构图"
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <div className="style-editor-footer">
                {original && (
                  <Button
                    type="button"
                    className="style-reset"
                    disabled={name === original.label && text === original.text}
                    onClick={() => {
                      setName(original.label);
                      setText(original.text);
                    }}
                  >
                    恢复预设
                  </Button>
                )}
                <Button type="button" onClick={close}>
                  取消
                </Button>
                <Button
                  type="button"
                  className="primary"
                  disabled={!name.trim() || !text.trim()}
                  onClick={() => {
                    onChange({ name: name.trim(), text: text.trim() });
                    close();
                  }}
                >
                  应用
                </Button>
              </div>
            </div>
          }
        >
          <Tooltip title={open ? undefined : "编辑风格"} trigger={["hover", "focus"]}>
            <Button
              ref={trigger}
              type="button"
              className="style-edit-trigger"
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
