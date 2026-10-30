import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Button, Popover, Typography } from "@tuyile/ui";

export function HelpPopover({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      title={title}
      content={<div className="help-content">{children}</div>}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Button
        type="button"
        className="help-trigger"
        aria-label={title}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.stopPropagation();
          }
        }}
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
