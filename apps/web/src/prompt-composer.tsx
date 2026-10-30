import { composeCreativePrompt, type CreationStyle } from "@tuyile/contracts";
import { WandSparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentRef } from "react";
import {
  Button,
  ChoiceField,
  Collapse,
  Input,
  Notice,
  Popover,
  Tooltip,
  useConfirm,
} from "@tuyile/ui";
import { promptExamples, stylePresets } from "./creation-presets";
export function PromptComposer({
  value,
  onChange,
  style,
  onStyleChange,
  label = "创作需求",
  rows = 4,
  height,
  compact = false,
  visible = true,
}: {
  value: string;
  onChange: (value: string) => void;
  style?: CreationStyle;
  onStyleChange: (style: CreationStyle | undefined) => void;
  label?: string;
  rows?: number;
  height?: number;
  compact?: boolean;
  visible?: boolean;
}) {
  const confirm = useConfirm(),
    id = useId(),
    textarea = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const assistTrigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible) setAssistOpen(false);
  }, [visible]);
  const preset = stylePresets.find(
    (p) => p.label === style?.name && p.text === style?.text,
  );
  const styleKey = style ? (preset?.id ?? "custom") : "none";
  const issue =
    style && !style.text.trim()
      ? "请填写风格描述。"
      : composeCreativePrompt({ prompt: value, style }).length > 12000
        ? "需求与风格合计不能超过 12000 字符。"
        : "";
  async function example(prompt: string) {
    if (
      value.trim() &&
      value !== prompt &&
      !(await confirm("用这个示例替换当前提示词？"))
    )
      return;
    onChange(prompt);
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
        value={styleKey}
        onValueChange={(next) => {
          const selected = stylePresets.find((p) => p.id === next);
          if (selected)
            onStyleChange(
              selected.text
                ? { name: selected.label, text: selected.text }
                : undefined,
            );
        }}
        options={[
          ...stylePresets.map((p) => ({ value: p.id, label: p.label })),
          ...(styleKey === "custom"
            ? [{ value: "custom", label: style?.name ?? "自定义风格" }]
            : []),
        ]}
      />
      {style && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: "style",
              label: "编辑风格",
              children: (
                <Input.TextArea
                  aria-label="风格描述"
                  value={style.text}
                  rows={3}
                  maxLength={2000}
                  onChange={(event) =>
                    onStyleChange({
                      name: "自定义风格",
                      text: event.target.value,
                    })
                  }
                />
              ),
            },
          ]}
        />
      )}
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
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          style={height ? { height, minHeight: height } : undefined}
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
      {issue && <Notice error>{issue}</Notice>}
    </div>
  );
}
