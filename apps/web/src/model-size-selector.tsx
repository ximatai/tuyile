import { useId, useState } from "react";
import type { ImageCapability } from "@tuyile/contracts";
import { imageSizeWithinKnownLimits } from "@tuyile/contracts";
import { Button, Collapse, Field, Notice, Radio, Select } from "@tuyile/ui";
import { standardSizes } from "./creation-presets";
import { sizeOptionLabel } from "./image-settings";
export function allowedConfiguredSize(
  cap: ImageCapability,
  width: number,
  height: number,
) {
  return (
    [width, height].every(
      (n) =>
        Number.isInteger(n) && n >= 256 && n % 16 === 0 && n <= cap.maxEdge,
    ) &&
    width * height <= cap.maxPixels &&
    imageSizeWithinKnownLimits(cap.model, width, height)
  );
}
export function ModelSizeSelector({
  capability,
  mode,
  onModeChange,
  value,
  onChange,
}: {
  capability: ImageCapability;
  mode: "range" | "fixed";
  onModeChange: (mode: "range" | "fixed") => void;
  value: string[];
  onChange: (sizes: string[]) => void;
}) {
  const id = useId();
  const [width, setWidth] = useState("1024"),
    [height, setHeight] = useState("1024");
  const valid = (size: string) => {
    const [w, h] = size.split("x").map(Number);
    return allowedConfiguredSize(capability, w!, h!);
  };
  const presets = [
    ...new Set([
      ...standardSizes.map((s) => `${s.width}x${s.height}`),
      "512x512",
      "1920x1088",
      "1088x1920",
    ]),
  ].filter(valid);
  const options = [...new Set([...presets, ...value])].map((size) => {
    const [w, h] = size.split("x").map(Number);
    return {
      value: size,
      label:
        sizeOptionLabel({ width: w!, height: h! }) +
        (valid(size) ? "" : "（超出范围）"),
    };
  });
  const customValid = allowedConfiguredSize(
    capability,
    Number(width),
    Number(height),
  );
  return (
    <div className="model-size-selector">
      <Radio.Group
        aria-label="尺寸开放方式"
        value={mode}
        onChange={(event) => onModeChange(event.target.value)}
        options={[
          { value: "range", label: "按模型范围开放" },
          { value: "fixed", label: "仅开放指定尺寸" },
        ]}
      />
      {mode === "fixed" && (
        <>
          <div className="field">
            <label htmlFor={id}>允许的尺寸</label>
            <Select
              id={id}
              aria-label="允许的尺寸"
              mode="multiple"
              value={value}
              onChange={onChange}
              options={options}
              optionFilterProp="label"
              showSearch
              maxCount={30}
              maxTagCount="responsive"
              placeholder="搜索并选择尺寸"
            />
          </div>
          {value.some((size) => !valid(size)) && (
            <Notice error>
              所选尺寸超出模型能力或当前配置上限，请调整或移除。
            </Notice>
          )}
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: "custom",
                label: "添加自定义尺寸",
                children: (
                  <div className="model-custom-size">
                    <div className="parameter-grid">
                      <Field
                        label="自定义宽度"
                        type="number"
                        min={256}
                        max={capability.maxEdge}
                        step={16}
                        value={width}
                        onChange={(event) => setWidth(event.target.value)}
                      />
                      <Field
                        label="自定义高度"
                        type="number"
                        min={256}
                        max={capability.maxEdge}
                        step={16}
                        value={height}
                        onChange={(event) => setHeight(event.target.value)}
                      />
                    </div>
                    {!customValid && (
                      <Notice error>
                        该尺寸不符合模型能力或当前配置上限。
                      </Notice>
                    )}
                    <Button
                      type="button"
                      disabled={!customValid || value.length >= 30}
                      onClick={() => {
                        if (!customValid || value.length >= 30) return;
                        onChange([
                          ...new Set([
                            ...value,
                            `${Number(width)}x${Number(height)}`,
                          ]),
                        ]);
                      }}
                    >
                      添加尺寸
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
