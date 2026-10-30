import { X, Upload as UploadIcon } from "lucide-react";
import { useState } from "react";
import type { ImageUsage } from "@tuyile/contracts";
import {
  Button,
  ChoiceField,
  Collapse,
  Field,
  Image,
  Upload,
  Tooltip,
} from "@tuyile/ui";
import {
  allowedQualities,
  modelChoices,
  selectedCapability,
  supportedSizePresets,
  sizeOptionLabel,
  initialSettings,
  validSize,
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
}: {
  usage?: ImageUsage;
  value: ImageSettings;
  onChange: (value: ImageSettings) => void;
  modelLabel?: string;
  count?: boolean;
  compact?: boolean;
  labelPrefix?: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const patch = (v: Partial<ImageSettings>) => {
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
      const sizeAllowed =
        next &&
        validSize(usage, next, value.width, value.height) &&
        (!next.sizes.length ||
          next.sizes.includes(`${value.width}x${value.height}`));
      onChange({
        ...value,
        modelKey: v.modelKey,
        width: sizeAllowed ? value.width : defaults.width,
        height: sizeAllowed ? value.height : defaults.height,
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
      className={`image-controls${compact ? " compact-image-controls" : ""}`}
    >
      <div className={compact ? "parameter-grid" : "model-control-row"}>
        <ChoiceField
          label={label(modelLabel)}
          value={value.modelKey}
          disabled={
            !choices.length ||
            (choices.length === 1 && choices[0]?.value === value.modelKey)
          }
          onValueChange={(modelKey) => patch({ modelKey })}
          showSearch={{ optionFilterProp: "label" }}
          popupMatchSelectWidth={440}
          optionRender={(option) => (
            <span className="model-choice-option">
              <span>{option.label}</span>
              {usage?.modelOptions?.find((m) => m.id === option.value)
                ?.isDefault && <span className="model-default-mark">默认</span>}
            </span>
          )}
          options={
            choices.some((m) => m.value === value.modelKey) || !value.modelKey
              ? choices
              : [
                  {
                    value: value.modelKey,
                    label: "历史模型（已不可用）",
                    disabled: true,
                  },
                  ...choices,
                ]
          }
          labelRender={
            compact
              ? (option) => {
                  const model =
                    usage?.modelOptions?.find((m) => m.id === option.value)
                      ?.modelId ?? String(option.value);
                  const shortNames: Record<string, string> = {
                    "gpt-image-2.5-sunburst": "Sunburst",
                    "gpt-image-2.5-flare": "Flare",
                  };
                  return (
                    <span title={String(option.label)}>
                      {shortNames[model] ?? model}
                    </span>
                  );
                }
              : undefined
          }
        />
        {compact && qualityControl}
      </div>
      <div className="parameter-grid">
        <ChoiceField
          label={label("比例")}
          value={currentSize?.ratio ?? "custom"}
          disabled={!ratios.length || (ratios.length === 1 && !!currentSize)}
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
          value={`${value.width}x${value.height}`}
          disabled={
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
              currentSize
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
      <div className={`parameter-grid${count ? " image-output-options" : ""}`}>
        {!compact && qualityControl}
        {count && (
          <ChoiceField
            label={label(labelPrefix ? "张数" : "图片张数")}
            value={String(value.count)}
            disabled={usage?.policy.maxCount === 1 && value.count === 1}
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
      {!!cap && !cap.sizes.length && (
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
                <div className="parameter-grid">
                  <Field
                    label={label("宽度")}
                    name="width"
                    type="number"
                    value={value.width}
                    onChange={(e) => patch({ width: Number(e.target.value) })}
                    min={256}
                    max={Math.min(
                      cap?.maxEdge ?? 8192,
                      usage?.policy.maxEdge ?? 8192,
                    )}
                    step={16}
                    required
                  />
                  <Field
                    label={label("高度")}
                    name="height"
                    type="number"
                    value={value.height}
                    onChange={(e) => patch({ height: Number(e.target.value) })}
                    min={256}
                    max={Math.min(
                      cap?.maxEdge ?? 8192,
                      usage?.policy.maxEdge ?? 8192,
                    )}
                    step={16}
                    required
                  />
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
export function ReferenceAttachments({
  references,
  onRemove,
  onUpload,
  disabled,
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
