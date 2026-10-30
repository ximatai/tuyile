import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Button as AntButton,
  Input,
  Alert,
  ConfigProvider,
  App,
  Select,
} from "antd";
import zhCN from "antd/locale/zh_CN";
export function UiProvider({ children }: { children: ReactNode }) {
  const nonce = document.querySelector<HTMLMetaElement>(
    'meta[name="csp-nonce"]',
  )?.content;
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      csp={nonce ? { nonce } : undefined}
      theme={{
        token: {
          colorPrimary: "#0062b0",
          colorInfo: "#0062b0",
          colorText: "#171f2a",
          colorBgLayout: "#f5f7fb",
          colorBorder: "#e6ecf4",
          borderRadius: 6,
          fontSize: 13,
          fontSizeSM: 12,
          fontSizeLG: 14,
          fontSizeXL: 16,
          fontSizeHeading1: 22,
          fontSizeHeading2: 18,
          fontSizeHeading3: 16,
          fontSizeHeading4: 14,
          fontSizeHeading5: 13,
          lineHeight: 1.6,
          controlHeight: 36,
          controlHeightSM: 28,
          controlHeightLG: 40,
          padding: 12,
          paddingLG: 20,
          margin: 12,
          marginLG: 20,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif',
          motion: !window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches,
        },
        components: {
          Table: {
            cellPaddingBlock: 10,
            cellPaddingInline: 12,
            cellPaddingBlockMD: 8,
            cellPaddingInlineMD: 10,
            cellFontSize: 13,
            cellFontSizeMD: 13,
            cellFontSizeSM: 13,
          },
          Tabs: {
            titleFontSize: 13,
            titleFontSizeSM: 13,
            horizontalItemPadding: "10px 0",
            horizontalItemPaddingSM: "8px 0",
          },
          Drawer: { footerPaddingBlock: 8, footerPaddingInline: 16 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
export function Button({
  children,
  className = "",
  type,
  color: _,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <AntButton
      className={`button ${className}`}
      type={className.split(" ").includes("primary") ? "primary" : "default"}
      htmlType={type ?? "submit"}
      {...props}
    >
      {children}
    </AntButton>
  );
}
export function Field({
  label,
  id: provided,
  size: _,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generated = useId(),
    id = provided ?? generated;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <Input id={id} {...props} />
    </label>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div className="product-notice">
      <Alert
        role={error ? "alert" : "status"}
        type={error ? "error" : "info"}
        showIcon
        description={children}
      />
    </div>
  );
}
export function useConfirm() {
  const { modal } = App.useApp();
  return (content: string) =>
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "请确认",
        content,
        okText: "确认",
        cancelText: "取消",
        onOk: () => {
          resolve(true);
        },
        onCancel: () => resolve(false),
      });
    });
}
export function ChoiceField({
  label,
  name,
  value,
  defaultValue,
  options,
  onValueChange,
  disabled,
  hideLabel = false,
}: {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId(),
    [local, setLocal] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? local;
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
      <Select
        id={id}
        value={current}
        options={options}
        disabled={disabled}
        onChange={(value) => {
          setLocal(value);
          onValueChange?.(value);
        }}
      />
      {name && <input type="hidden" name={name} value={current} />}
    </div>
  );
}
export {
  Collapse,
  Image,
  Upload,
  Checkbox,
  Table,
  Input,
  Tag,
  Statistic,
  Empty,
  Tabs,
  Form,
  ConfigProvider as ControlScope,
} from "antd";
export { Select } from "antd";
export {
  Drawer,
  Card,
  Radio,
  Tooltip,
  Popover,
  Dropdown,
  Affix,
  Typography,
} from "antd";
