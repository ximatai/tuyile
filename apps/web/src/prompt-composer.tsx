import { WandSparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentRef } from "react";
import {
  Button,
  ChoiceField,
  Input,
  Notice,
  Popover,
  Tooltip,
  useConfirm,
} from "@tuyile/ui";
import {
  applyStyle,
  promptExamples,
  styleParagraph,
  stylePresets,
} from "./creation-presets";
export function PromptComposer({
  value,
  onChange,
  label = "创作需求",
  rows = 4,
  compact = false,
  visible = true,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  rows?: number;
  compact?: boolean;
  visible?: boolean;
}) {
  const confirm = useConfirm(),
    id = useId(),
    textarea = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const [style, setStyle] = useState("none"),
    [error, setError] = useState(""),
    [assistOpen, setAssistOpen] = useState(false);
  const assistTrigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible) setAssistOpen(false);
  }, [visible]);
  const emitted = useRef(value);
  useEffect(() => {
    // Reuse/transfer supplies a complete visible prompt; never append a second hidden style.
    if (value !== emitted.current) {
      setStyle("none");
      setError("");
      emitted.current = value;
    }
  }, [value]);
  function update(next: string) {
    if (next.length > 12000) {
      setError("提示词已达长度上限，请精简后再添加风格。");
      return false;
    }
    emitted.current = next;
    setError("");
    onChange(next);
    return true;
  }
  async function example(prompt: string) {
    if (
      value.trim() &&
      value !== prompt &&
      !(await confirm("用这个示例替换当前提示词？"))
    )
      return;
    setStyle("none");
    update(prompt);
    setAssistOpen(false);
    textarea.current?.focus();
  }
  const assist = (
    <div className="prompt-assist-controls">
      {" "}
      <div className="prompt-shortcuts" role="group" aria-label="快捷提示词">
        {promptExamples.map((p) => (
          <Tooltip key={p.label} title={p.prompt} trigger={["hover", "focus"]}>
            <Button type="button" onClick={() => void example(p.prompt)}>
              {p.label}
            </Button>
          </Tooltip>
        ))}
      </div>
      <ChoiceField
        label="风格"
        value={style}
        onValueChange={(next) => {
          if (update(applyStyle(value, style, next))) {
            setStyle(next);
            setAssistOpen(false);
            textarea.current?.focus();
          }
        }}
        options={stylePresets.map((p) => ({ value: p.id, label: p.label }))}
      />
    </div>
  );
  return (
    <div
      ref={assistTrigger}
      className={`prompt-composer ${compact ? "prompt-composer-compact" : ""}`}
    >
      <label className="field" htmlFor={id}>
        <span className={compact ? "sr-only" : undefined}>{label}</span>
        <Input.TextArea
          ref={textarea}
          id={id}
          name="prompt"
          aria-label={label}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (
              style !== "none" &&
              !next.split("\n\n").includes(styleParagraph(style))
            )
              setStyle("none");
            update(next);
          }}
          rows={rows}
          required
          maxLength={12000}
          placeholder="描述主体、场景、光线、构图和关键细节"
        />
      </label>
      {compact ? (
        <Popover
          trigger="click"
          placement="leftBottom"
          open={assistOpen}
          onOpenChange={setAssistOpen}
          title="灵感与风格"
          content={
            <div
              className="prompt-assist-content"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAssistOpen(false);
                  event.stopPropagation();
                  assistTrigger.current
                    ?.querySelector<HTMLButtonElement>(".prompt-assist-trigger")
                    ?.focus();
                }
              }}
            >
              {assist}
            </div>
          }
        >
          <Button
            className="prompt-assist-trigger"
            type="button"
            aria-label="灵感与风格"
            aria-expanded={assistOpen}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAssistOpen(false);
                event.stopPropagation();
              }
            }}
          >
            <WandSparkles size={16} aria-hidden="true" />
          </Button>
        </Popover>
      ) : (
        assist
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
