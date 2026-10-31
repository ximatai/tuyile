import { PromptFavorite } from "./prompt-favorite";
import { StyleSelector } from "./style-selector";
import { composeCreativePrompt, type CreationStyle } from "@tuyile/contracts";
import { WandSparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentRef } from "react";
import {
  Button,
  Input,
  Notice,
  Popover,
  useConfirm,
  useControlsDisabled,
} from "@tuyile/ui";
import { PromptShortcuts } from "./prompt-shortcuts";
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
  const disabled = useControlsDisabled();
  const confirm = useConfirm(),
    id = useId(),
    textarea = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const assistTrigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible || disabled) setAssistOpen(false);
  }, [visible, disabled]);
  const issue =
    style && !style.text.trim()
      ? "请填写风格描述。"
      : composeCreativePrompt({ prompt: value, style }).length > 12000
        ? "需求与风格合计不能超过 12000 字符。"
        : "";
  async function applyPrompt(prompt: string) {
    if (disabled) return false;
    if (
      value.trim() &&
      value !== prompt &&
      !(await confirm("用选中的提示词替换当前内容？"))
    )
      return false;
    onChange(prompt);
    setAssistOpen(false);
    textarea.current?.focus();
    return true;
  }
  const assist = (
    <div className="prompt-assist-controls">
      <PromptShortcuts
        onChoose={applyPrompt}
        visible={visible && (!compact || assistOpen)}
      />
      {compact && <PromptFavorite prompt={value} visible={visible} />}
      <StyleSelector
        style={style}
        onChange={onStyleChange}
        visible={visible && (!compact || assistOpen)}
      />
    </div>
  );
  return (
    <div
      ref={assistTrigger}
      className={`prompt-composer ${compact ? "prompt-composer-compact" : ""}`}
    >
      <div className="field">
        {compact ? (
          <label className="sr-only" htmlFor={id}>
            {label}
          </label>
        ) : (
          <div className="field-heading prompt-composer-heading-row">
            <label htmlFor={id}>{label}</label>
            <PromptFavorite prompt={value} visible={visible} />
          </div>
        )}
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
      </div>
      {compact ? (
        <Popover
          trigger="click"
          placement="leftBottom"
          open={assistOpen}
          onOpenChange={setAssistOpen}
          title="灵感与风格"
          classNames={{ root: "creation-popover prompt-assist-popover" }}
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
            disabled={disabled}
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
