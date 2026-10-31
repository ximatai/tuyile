import {
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Info } from "lucide-react";
import { Button, Popover, Typography } from "@tuyile/ui";

export function HelpPopover({
  title,
  children,
  visible = true,
}: {
  title: string;
  children: ReactNode;
  visible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<ComponentRef<typeof Button>>(null);
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  function escape(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }
  return (
    <Popover
      title={title}
      classNames={{ root: "creation-popover help-popover" }}
      content={
        <div className="help-content" tabIndex={0} onKeyDown={escape}>
          {children}
        </div>
      }
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Button
        ref={trigger}
        type="button"
        className="help-trigger"
        aria-label={title}
        aria-expanded={open}
        onKeyDown={escape}
      >
        <Info size={16} aria-hidden="true" />
      </Button>
    </Popover>
  );
}

export function Excerpt({
  children,
  rows = 4,
}: {
  children: string;
  rows?: number;
}) {
  return (
    <Typography.Paragraph
      className="content-excerpt"
      ellipsis={{
        rows,
        expandable: "collapsible",
        symbol: (expanded) => (expanded ? "收起" : "展开"),
      }}
    >
      {children}
    </Typography.Paragraph>
  );
}
