import { useState } from "react";
import type { ImageUsage } from "@tuyile/contracts";
import {
  Button,
  ChoiceField,
  Collapse,
  Field,
  Image,
  Radio,
  Upload,
  Tooltip,
} from "@tuyile/ui";
import {
  allowedQualities,
  modelChoices,
  selectedCapability,
  supportedSizePresets,
  type ImageSettings,
} from "./image-settings";
export function ImageControls({
  usage,
  value,
  onChange,
  modelLabel = "图片模型",
  count = true,
  labelPrefix = "",
}: {
  usage?: ImageUsage;
  value: ImageSettings;
  onChange: (value: ImageSettings) => void;
  modelLabel?: string;
  count?: boolean;
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
  const patch = (v: Partial<ImageSettings>) => onChange({ ...value, ...v });
  const qualityNames = { low: "低", medium: "中", high: "高" };
  return (
    <div className="image-controls">
      <ChoiceField
        label={label(modelLabel)}
        value={value.modelKey}
        onValueChange={(modelKey) => patch({ modelKey })}
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
      />
      <div className="parameter-grid">
        <ChoiceField
          label={label("分辨率")}
          value={currentSize?.tier ?? "custom"}
          options={[...new Set(sizes.map((s) => s.tier))]
            .map((tier) => ({ value: tier, label: tier }))
            .concat(currentSize ? [] : [{ value: "custom", label: "自定义" }])}
          onValueChange={(tier) => {
            if (tier === "custom") {
              setAdvancedOpen(true);
              return;
            }
            const next =
              sizes.find(
                (s) => s.tier === tier && s.ratio === currentSize?.ratio,
              ) ?? sizes.find((s) => s.tier === tier);
            if (next) patch({ width: next.width, height: next.height });
          }}
        />
        <ChoiceField
          label={label("比例")}
          value={currentSize?.ratio ?? "custom"}
          options={[...new Set(sizes.map((s) => s.ratio))]
            .map((ratio) => ({ value: ratio, label: ratio }))
            .concat(currentSize ? [] : [{ value: "custom", label: "自定义" }])}
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
      </div>
      <span className="size-pixels" aria-label={label("实际尺寸")}>
        {value.width} × {value.height} px
      </span>
      <div className="parameter-grid">
        <ChoiceField
          label={label("质量")}
          name="quality"
          value={value.quality}
          onValueChange={(quality) =>
            patch({ quality: quality as ImageSettings["quality"] })
          }
          options={(["low", "medium", "high"] as const).map((q) => ({
            value: q,
            label: qualityNames[q],
            disabled: !qualities.includes(q),
          }))}
        />
        {count && (
          <div className="count-control">
            <Field
              label={label(labelPrefix ? "张数" : "图片张数")}
              name="count"
              type="number"
              value={value.count}
              onChange={(e) => patch({ count: Number(e.target.value) })}
              min={1}
              max={usage?.policy.maxCount ?? 16}
              required
            />
            <Radio.Group
              size="small"
              aria-label={label("快捷张数")}
              value={value.count}
              onChange={(e) => patch({ count: e.target.value })}
              options={[1, 2, 4].map((n) => ({
                value: n,
                label: String(n),
                disabled: n > (usage?.policy.maxCount ?? 16),
              }))}
              optionType="button"
              buttonStyle="solid"
            />
          </div>
        )}
      </div>
      <Collapse
        activeKey={advancedOpen ? ["advanced"] : []}
        onChange={(keys) => setAdvancedOpen(keys.includes("advanced"))}
        size="small"
        ghost
        items={[
          {
            key: "advanced",
            label: "更多设置",
            forceRender: true,
            children: (
              <>
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
                    disabled={!!cap?.sizes.length}
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
                    disabled={!!cap?.sizes.length}
                    required
                  />
                </div>
                <ChoiceField
                  label={label("格式")}
                  name="format"
                  value={value.format}
                  onValueChange={(format) =>
                    patch({ format: format as ImageSettings["format"] })
                  }
                  options={(["png", "jpeg", "webp"] as const).map((f) => ({
                    value: f,
                    label: f === "webp" ? "WebP" : f.toUpperCase(),
                    disabled: !cap?.formats.includes(f),
                  }))}
                />
              </>
            ),
          },
        ]}
      />
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
        <span>参考图{references.length ? ` · ${references.length}` : ""}</span>
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
            <Button
              type="button"
              disabled={disabled || references.length >= maxReferences}
            >
              {agent ? "添加 Agent 参考图" : "选择参考图"}
            </Button>
          </Upload>
        </div>
      </div>
      {!!references.length && (
        <div className="attachment-list">
          {references.map((r) => (
            <div className="attachment" key={r.id}>
              <Image
                width={48}
                height={48}
                src={`/api/images/assets/${r.id}/preview`}
                alt={r.name}
                preview={{
                  src: `/api/images/assets/${r.id}/original`,
                  motionName: "",
                }}
              />
              <span className="attachment-name" title={r.name}>
                {r.name}
              </span>
              <Button
                type="button"
                disabled={disabled}
                aria-label={
                  agent ? `移除 Agent 参考图 ${r.name}` : `移除引用 ${r.name}`
                }
                onClick={() => onRemove(r.id)}
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
