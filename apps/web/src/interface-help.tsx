import {
  useCallback,
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
  actionLabel,
}: {
  title: string;
  children: ReactNode;
  visible?: boolean;
  actionLabel?: string;
}) {
  const interactive = actionLabel !== undefined;
  const [open, setOpen] = useState(false);
  const trigger = useRef<ComponentRef<typeof Button>>(null);
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (open && interactive) node?.focus({ preventScroll: true });
    },
    [open, interactive],
  );
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  function escape(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
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
        <div
          ref={contentRef}
          className={
            interactive ? "help-content help-content-scroll" : "help-content"
          }
          role={interactive ? "dialog" : undefined}
          aria-label={interactive ? title : undefined}
          tabIndex={0}
          onKeyDown={escape}
        >
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
        className={interactive ? undefined : "help-trigger"}
        aria-label={interactive ? undefined : title}
        aria-haspopup={interactive ? "dialog" : undefined}
        aria-expanded={open}
        onKeyDown={escape}
      >
        {actionLabel ?? <Info size={16} aria-hidden="true" />}
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
