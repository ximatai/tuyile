import { modelDisplayName } from "./model-presentation";
import { X, Upload as UploadIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ImageUsage } from "@tuyile/contracts";
import {
  Button,
  ChoiceField,
  Collapse,
  Field,
  Image,
  Upload,
  Tooltip,
  useControlsDisabled,
} from "@tuyile/ui";
import {
  allowedQualities,
  modelChoices,
  selectedCapability,
  supportedSizePresets,
  sizeOptionLabel,
  initialSettings,
  imageSizeCorrections,
  imageSizeIssue,
  imageSizeFieldIssues,
  sizeCorrectionLabel,
  modelSwitchSize,
  type ImageSettings,
} from "./image-settings";
export function ImageControls({
  usage,
  value,
  onChange,
  modelLabel = "图片模型",
  count = true,
  compact = false,
  labelPrefix = "",
  disabled: disabledProp = false,
}: {
  usage?: ImageUsage;
  value: ImageSettings;
  onChange: (value: ImageSettings) => void;
  modelLabel?: string;
  count?: boolean;
  compact?: boolean;
  labelPrefix?: string;
  disabled?: boolean;
}) {
  const disabled = useControlsDisabled(disabledProp);
  const [editing, setEditing] = useState<"width" | "height" | null>(null);
  const [sizeChange, setSizeChange] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const customSizeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const section = customSizeRef.current;
    if (!advancedOpen || !section) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Move only the editor's scroll area, never the page behind a popover.
        let container = section.parentElement;
        while (
          container &&
          !/(auto|scroll)/.test(getComputedStyle(container).overflowY)
        )
          container = container.parentElement;
        if (!container) return;
        const bounds = container.getBoundingClientRect();
        const box = section.getBoundingClientRect();
        if (box.bottom > bounds.bottom)
          container.scrollTop += Math.min(
            box.bottom - bounds.bottom,
            Math.max(0, box.top - bounds.top),
          );
        else if (box.top < bounds.top)
          container.scrollTop += box.top - bounds.top;
      });
    };
    // Follow only the initial Collapse animation; later validation must not scroll.
    const observer = new ResizeObserver(reveal);
    const stopFollowing = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    const stop = window.setTimeout(stopFollowing, 350);
    section.addEventListener("focusin", stopFollowing);
    observer.observe(section);
    reveal();
    return () => {
      window.clearTimeout(stop);
      section.removeEventListener("focusin", stopFollowing);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [advancedOpen, value.modelKey]);
  const modelName = (key: string) => {
    if (!choices.some((option) => option.value === key))
      return "历史模型（已不可用）";
    const model =
      usage?.modelOptions?.find((m) => m.id === key)?.modelId ?? key;
    return modelDisplayName(model);
  };
  const label = (text: string) =>
    labelPrefix ? `${labelPrefix} ${text}` : text;
  const cap = usage && selectedCapability(usage, value.modelKey),
    sizes = usage ? supportedSizePresets(usage, cap) : [],
    choices = modelChoices(usage),
    currentSize = sizes.find(
      (s) => s.width === value.width && s.height === value.height,
    ),
    qualities = usage ? allowedQualities(usage, cap) : [];
  const formats = (["png", "jpeg", "webp"] as const).filter((format) =>
    cap?.formats.includes(format),
  );
  const ratios = [...new Set(sizes.map((size) => size.ratio))];
  const sameRatioSizes = sizes.filter(
    (size) => !currentSize || size.ratio === currentSize.ratio,
  );
  const sizeHintId = useId();
  const sizeIssue = usage && cap && imageSizeIssue(usage, cap, value);
  const fields =
    usage && cap
      ? imageSizeFieldIssues(usage, cap, value)
      : { width: undefined, height: undefined };
  const combinationIssue =
    !fields.width && !fields.height ? sizeIssue : undefined;
  // Existing invalid values need feedback before the user touches either field.
  // Only an active edit defers validation; blur restores the current errors.
  const visibleFields = {
    width: editing !== "width" && fields.width,
    height: editing !== "height" && fields.height,
  };
  const visibleCombination = !editing && combinationIssue;
  const maxEdge =
    cap && usage ? Math.min(cap.maxEdge, usage.policy.maxEdge) : 256;
  const suggestions =
    usage && cap ? imageSizeCorrections(usage, cap, value) : [];
  const patch = (v: Partial<ImageSettings>) => {
    if (disabled) return;
    if (v.modelKey && usage && v.modelKey !== value.modelKey) {
      const nextUsage = {
        ...usage,
        models: [v.modelKey, ...usage.models.filter((id) => id !== v.modelKey)],
        modelOptions: usage.modelOptions?.map((model) => ({
          ...model,
          isDefault: model.id === v.modelKey,
        })),
      };
      const defaults = initialSettings(nextUsage);
      const next = selectedCapability(usage, v.modelKey);
      if (next?.sizes.length) setAdvancedOpen(false);
      if (next && !next.sizes.length && imageSizeIssue(usage, next, value))
        setAdvancedOpen(true);
      const dimensions = modelSwitchSize(usage, v.modelKey, value);
      setSizeChange(
        dimensions.width
          ? `已由 ${value.width} × ${value.height} 调整为 ${dimensions.width} × ${dimensions.height}，以符合当前模型。`
          : "",
      );
      setEditing(null);
      onChange({
        ...value,
        ...dimensions,
        modelKey: v.modelKey,
        quality:
          next && allowedQualities(usage, next).includes(value.quality)
            ? value.quality
            : defaults.quality,
        format: next?.formats.includes(value.format)
          ? value.format
          : defaults.format,
      });
      return;
    }
    setSizeChange("");
    onChange({ ...value, ...v });
  };
  const qualityNames = { low: "快速草稿", medium: "标准", high: "高质量" };
  const ratioLabel = (ratio: string) => {
    const [w, h] = ratio.split(":").map(Number);
    return (
      <span className="ratio-option">
        {w && h ? (
          <span className="ratio-icon-slot" aria-hidden="true">
            <span
              className="ratio-icon"
              style={{
                width: 18 * Math.min(1, w / h),
                height: 18 * Math.min(1, h / w),
              }}
            />
          </span>
        ) : null}
        <span>{ratio === "custom" ? "自定义" : ratio}</span>
      </span>
    );
  };
  const qualityControl = (
    <ChoiceField
      label={label("质量")}
      name="quality"
      value={value.quality}
      onValueChange={(quality) =>
        patch({ quality: quality as ImageSettings["quality"] })
      }
      disabled={
        disabled ||
        !qualities.length ||
        (qualities.length === 1 && qualities.includes(value.quality))
      }
      options={qualities.map((q) => ({
        value: q,
        label: qualityNames[q],
      }))}
    />
  );
  return (
    <div
      className={`image-controls${compact ? " compact-image-controls" : ""}${count ? "" : " image-controls-single-output"}`}
    >
      <div className={compact ? "parameter-grid" : "model-control-row"}>
        <ChoiceField
          label={label(modelLabel)}
          value={value.modelKey}
          disabled={
            disabled ||
            !choices.length ||
            (choices.length === 1 && choices[0]?.value === value.modelKey)
          }
          onValueChange={(modelKey) => patch({ modelKey })}
          showSearch={false}
          popupMatchSelectWidth={280}
          optionRender={(option) => (
            <span className="model-choice-option">
              <span>
                {usage?.modelOptions?.find((m) => m.id === option.value)
                  ?.modelId ??
                  (choices.some((choice) => choice.value === option.value)
                    ? String(option.value)
                    : option.label)}
                {usage?.modelOptions?.find((m) => m.id === option.value)
                  ?.serviceName
                  ? ` · ${usage.modelOptions.find((m) => m.id === option.value)!.serviceName}`
                  : ""}
              </span>
              {usage?.modelOptions?.find((m) => m.id === option.value)
                ?.isDefault && <span className="model-default-mark">默认</span>}
            </span>
          )}
          options={(choices.some((m) => m.value === value.modelKey) ||
          !value.modelKey
            ? choices
            : [
                {
                  value: value.modelKey,
                  label: "历史模型（已不可用）",
                  disabled: true,
                },
                ...choices,
              ]
          ).map((option) => ({ ...option, title: "" }))}
          labelRender={
            compact ? (option) => modelName(String(option.value)) : undefined
          }
        />
        {compact && qualityControl}
      </div>
      {sizeChange && (
        <p className="hint" role="status">
          {sizeChange}
        </p>
      )}
      <div className="parameter-grid">
        <ChoiceField
          label={label("比例")}
          value={
            currentSize?.ratio ?? (cap?.sizes.length ? undefined : "custom")
          }
          disabled={
            disabled || !ratios.length || (ratios.length === 1 && !!currentSize)
          }
          optionRender={(option) => ratioLabel(String(option.value))}
          labelRender={(option) => ratioLabel(String(option.value))}
          options={ratios
            .map((ratio) => ({ value: ratio, label: ratio }))
            .concat(
              currentSize || cap?.sizes.length
                ? []
                : [{ value: "custom", label: "自定义" }],
            )}
          onValueChange={(ratio) => {
            if (ratio === "custom") {
              setAdvancedOpen(true);
              return;
            }
            const next =
              sizes.find(
                (s) => s.ratio === ratio && s.tier === currentSize?.tier,
              ) ?? sizes.find((s) => s.ratio === ratio);
            if (next) patch({ width: next.width, height: next.height });
          }}
        />
        <ChoiceField
          label={label("尺寸")}
          value={
            cap?.sizes.length && !currentSize
              ? undefined
              : `${value.width}x${value.height}`
          }
          disabled={
            disabled ||
            !sameRatioSizes.length ||
            (sameRatioSizes.length === 1 && !!currentSize)
          }
          options={sameRatioSizes
            .sort((a, b) => a.width * a.height - b.width * b.height)
            .map((s) => ({
              value: `${s.width}x${s.height}`,
              label: sizeOptionLabel(s),
            }))
            .concat(
              currentSize || cap?.sizes.length
                ? []
                : [
                    {
                      value: `${value.width}x${value.height}`,
                      label: `${value.width} × ${value.height}（自定义）`,
                    },
                  ],
            )}
          onValueChange={(key) => {
            const next = sizes.find((s) => `${s.width}x${s.height}` === key);
            if (next) patch({ width: next.width, height: next.height });
          }}
        />
      </div>
      <div
        className={`parameter-grid${count || compact ? " image-output-options" : ""}`}
      >
        {!compact && qualityControl}
        {count && (
          <ChoiceField
            label={label(labelPrefix ? "张数" : "图片张数")}
            value={String(value.count)}
            disabled={
              disabled || (usage?.policy.maxCount === 1 && value.count === 1)
            }
            onValueChange={(count) => patch({ count: Number(count) })}
            options={Array.from(
              { length: usage?.policy.maxCount ?? 16 },
              (_, i) => ({ value: String(i + 1), label: `${i + 1} 张` }),
            )}
          />
        )}
        <ChoiceField
          label={label("格式")}
          name="format"
          value={value.format}
          disabled={
            disabled ||
            !formats.length ||
            (formats.length === 1 && formats.includes(value.format))
          }
          onValueChange={(format) =>
            patch({ format: format as ImageSettings["format"] })
          }
          options={formats.map((f) => ({
            value: f,
            label: f === "webp" ? "WebP" : f.toUpperCase(),
          }))}
        />
      </div>
      {(!!cap?.complexities?.length || value.complexity !== undefined) && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: "complexity",
              label: "进阶设置",
              children: (
                <ChoiceField
                  label={label("复杂度")}
                  value={value.complexity ?? "default"}
                  disabled={disabled}
                  options={[
                    { value: "default", label: "模型默认" },
                    ...(cap?.complexities ?? []).map((v) => ({
                      value: v,
                      label: { low: "低", medium: "中", high: "高" }[v],
                    })),
                  ]}
                  onValueChange={(v) =>
                    patch({
                      complexity:
                        v === "default"
                          ? undefined
                          : (v as ImageSettings["complexity"]),
                    })
                  }
                />
              ),
            },
          ]}
        />
      )}
      {sizeIssue && (!advancedOpen || !!cap?.sizes.length) && (
        <p className="size-field-error" role="status">
          {sizeIssue}
        </p>
      )}
      {!!cap && !cap.sizes.length && (
        <div ref={customSizeRef}>
          <Collapse
            activeKey={advancedOpen ? ["advanced"] : []}
            onChange={(keys) => setAdvancedOpen(keys.includes("advanced"))}
            size="small"
            ghost
            items={[
              {
                key: "advanced",
                label: "自定义尺寸",
                forceRender: true,
                children: (
                  <div>
                    <div className="parameter-grid">
                      {(["width", "height"] as const).map((axis) => (
                        <div key={axis}>
                          <Field
                            label={label(axis === "width" ? "宽度" : "高度")}
                            disabled={disabled}
                            name={axis}
                            type="number"
                            value={value[axis] || ""}
                            onChange={(e) => {
                              patch({ [axis]: Number(e.target.value) });
                            }}
                            onFocus={() => setEditing(axis)}
                            onBlur={() => setEditing(null)}
                            aria-invalid={
                              !!(visibleFields[axis] || visibleCombination)
                            }
                            aria-describedby={
                              [
                                visibleFields[axis] && `${sizeHintId}-${axis}`,
                                visibleCombination && `${sizeHintId}-combined`,
                              ]
                                .filter(Boolean)
                                .join(" ") || undefined
                            }
                            min={256}
                            max={maxEdge}
                            step={16}
                            required
                          />
                          <p
                            id={`${sizeHintId}-${axis}`}
                            className="size-field-error"
                            aria-live="polite"
                          >
                            {visibleFields[axis]}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p
                      id={`${sizeHintId}-combined`}
                      className="size-field-error"
                      aria-live="polite"
                    >
                      {visibleCombination}
                    </p>
                    {suggestions.length > 0 &&
                      (visibleCombination ||
                        visibleFields.width ||
                        visibleFields.height) && (
                        <div className="size-corrections">
                          {suggestions.map(({ width, height }) => (
                            <Button
                              key={`${width}x${height}`}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                const axis =
                                  width !== value.width ? "width" : "height";
                                patch({ width, height });
                                customSizeRef.current
                                  ?.querySelector<HTMLInputElement>(
                                    `input[name="${axis}"]`,
                                  )
                                  ?.focus();
                              }}
                            >
                              {sizeCorrectionLabel(value, { width, height })}
                            </Button>
                          ))}
                        </div>
                      )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
export function ReferenceAttachments({
  references,
  onRemove,
  onUpload,
  disabled: disabledProp,
  maxReferences = 4,
  agent = false,
  selected = [],
  onUseSelected,
}: {
  references: { id: string; name: string }[];
  onRemove: (id: string) => void;
  onUpload: (file: File) => void;
  disabled: boolean;
  maxReferences?: number;
  agent?: boolean;
  selected?: { id: string; name: string }[];
  onUseSelected?: () => void;
}) {
  const disabled = useControlsDisabled(disabledProp);
  return (
    <div
      className="reference-attachments"
      data-testid={agent ? "agent-reference-upload" : "reference-upload"}
    >
      <div className="attachment-heading">
        <span className="editor-field-label">
          参考图
          {references.length > 0 && (
            <span className="reference-count"> · {references.length}</span>
          )}
        </span>
        <div className="attachment-actions">
          {selected.length > 0 && onUseSelected && (
            <Tooltip
              title={
                maxReferences === 0
                  ? "此模型不支持参考图"
                  : new Set([
                        ...references.map((r) => r.id),
                        ...selected.map((r) => r.id),
                      ]).size > maxReferences
                    ? `此模型最多支持${maxReferences}张参考图，请减少选图或移除已有引用`
                    : !selected.some(
                          (s) => !references.some((r) => r.id === s.id),
                        )
                      ? "选中图片已在参考图中"
                      : undefined
              }
            >
              <span>
                <Button
                  type="button"
                  disabled={
                    disabled ||
                    !selected.some(
                      (s) => !references.some((r) => r.id === s.id),
                    ) ||
                    new Set([
                      ...references.map((r) => r.id),
                      ...selected.map((r) => r.id),
                    ]).size > maxReferences
                  }
                  onClick={onUseSelected}
                >
                  引用选中 {selected.length} 张
                </Button>
              </span>
            </Tooltip>
          )}
          <Upload
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            disabled={disabled || references.length >= maxReferences}
            beforeUpload={(file) => {
              onUpload(file);
              return false;
            }}
          >
            <Tooltip title="上传参考图" trigger={["hover", "focus"]}>
              <Button
                type="button"
                className="reference-upload-icon"
                aria-label="上传参考图"
                disabled={disabled || references.length >= maxReferences}
              >
                <UploadIcon size={16} aria-hidden="true" />
              </Button>
            </Tooltip>
          </Upload>
        </div>
      </div>
      {!!references.length && (
        <div className="attachment-list">
          {references.map((r) => (
            <div className="attachment" key={r.id} title={r.name}>
              <Image
                width={64}
                height={64}
                src={`/api/images/assets/${r.id}/preview`}
                alt={r.name}
                preview={{
                  src: `/api/images/assets/${r.id}/original`,
                  motionName: "",
                }}
              />
              <Tooltip title="移除">
                <Button
                  type="button"
                  disabled={disabled}
                  aria-label={
                    agent ? `移除 Agent 参考图 ${r.name}` : `移除引用 ${r.name}`
                  }
                  onClick={() => onRemove(r.id)}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
