import {
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type ComponentProps,
} from "react";
import {
  Button as AntButton,
  Input,
  Alert,
  ConfigProvider,
  App,
  Select,
  type SelectProps,
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
          controlHeight: 32,
          controlHeightSM: 28,
          controlHeightLG: 36,
          padding: 10,
          paddingLG: 20,
          margin: 10,
          marginLG: 20,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif',
          motion: !window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches,
        },
        components: {
          Table: {
            cellPaddingBlock: 8,
            cellPaddingInline: 12,
            cellPaddingBlockMD: 7,
            cellPaddingInlineMD: 10,
            cellFontSize: 13,
            cellFontSizeMD: 13,
            cellFontSizeSM: 13,
          },
          Tabs: {
            titleFontSize: 13,
            titleFontSizeSM: 13,
            horizontalItemPadding: "8px 0",
            horizontalItemPaddingSM: "6px 0",
          },
          Drawer: { footerPaddingBlock: 8, footerPaddingInline: 16 },
          Message: { contentBg: "#fff", contentPadding: "8px 14px" },
        },
      }}
    >
      <App message={{ top: 60, maxCount: 1 }}>{children}</App>
    </ConfigProvider>
  );
}
export function Button({
  children,
  className = "",
  type,
  color: _,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  ref?: ComponentProps<typeof AntButton>["ref"];
}) {
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
        title={children}
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
  groups,
  onValueChange,
  disabled,
  hideLabel = false,
  labelExtra,
  showSearch,
  optionRender,
  labelRender,
  popupMatchSelectWidth,
}: {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  groups?: SelectProps["options"];
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  labelExtra?: ReactNode;
  showSearch?: SelectProps["showSearch"];
  optionRender?: SelectProps["optionRender"];
  labelRender?: SelectProps["labelRender"];
  popupMatchSelectWidth?: SelectProps["popupMatchSelectWidth"];
}) {
  const id = useId(),
    [local, setLocal] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? local;
  return (
    <div className="field">
      {labelExtra ? (
        <div className="field-heading">
          <label
            htmlFor={id}
            className={hideLabel ? "sr-only" : undefined}
            title={label}
          >
            {label}
          </label>
          {labelExtra}
        </div>
      ) : (
        <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
          {label}
        </label>
      )}
      <Select
        id={id}
        value={current}
        options={groups ?? options}
        disabled={disabled}
        showSearch={showSearch}
        optionRender={optionRender}
        labelRender={labelRender}
        popupMatchSelectWidth={popupMatchSelectWidth}
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
  Modal,
  Collapse,
  Spin,
  Skeleton,
  Image,
  Upload,
  Checkbox,
  Table,
  Input,
  Tag,
  Statistic,
  Progress,
  Descriptions,
  Empty,
  Tabs,
  Form,
  ConfigProvider as ControlScope,
} from "antd";
export { Select, AutoComplete } from "antd";
export {
  Drawer,
  Card,
  Radio,
  Tooltip,
  Popover,
  Menu,
  Dropdown,
  Affix,
  Typography,
} from "antd";

export function useNotification() {
  return App.useApp().notification;
}

/** Transient operation feedback. Persistent state and validation stay with their controls. */
export function useFeedback() {
  const { message } = App.useApp();
  return useMemo(() => {
    const show = (type: "success" | "error", content: string) => {
      if (!content.trim()) return;
      void message.open({
        key: "operation-feedback",
        type,
        content: (
          <span role={type === "error" ? "alert" : "status"}>{content}</span>
        ),
        duration: type === "success" ? 2 : 5,
        className: "operation-feedback",
      });
    };
    return {
      success: (content: string) => show("success", content),
      error: (content: string) => show("error", content),
      dismiss: () => message.destroy("operation-feedback"),
    };
  }, [message]);
}
