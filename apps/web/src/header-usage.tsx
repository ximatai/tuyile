import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ArrowRight, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ImageUsage } from "@tuyile/contracts";
import { Button, Popover } from "@tuyile/ui";
import { client } from "./api";
import { useSessionState } from "./session-state";
import { UsageSummary } from "./usage-summary";
export function HeaderUsage({ csrfToken }: { csrfToken: string }) {
  const session = useSessionState();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<ComponentRef<typeof Button>>(null);
  const query = useQuery({
    queryKey: session.key("usage"),
    queryFn: ({ signal }) =>
      client(csrfToken)<ImageUsage>("/images/usage", undefined, signal),
    refetchInterval: 1500,
  });
  useEffect(() => setOpen(false), [pathname]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function escape(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      classNames={{ root: "creation-popover header-usage-popover" }}
      content={
        <div onKeyDown={escape}>
          <Button
            type="button"
            className="header-usage-close"
            aria-label="关闭额度详情"
            onClick={close}
          >
            <X size={16} />
          </Button>
          {query.error && <p role="alert">额度暂时无法更新</p>}
          {query.data && <UsageSummary usage={query.data} visible={open} />}
          <Link
            className="header-usage-details"
            to="/usage"
            onClick={() => setOpen(false)}
          >
            <span>查看额度</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      }
    >
      <Button
        ref={trigger}
        type="button"
        className="header-usage"
        aria-expanded={open}
        onKeyDown={escape}
      >
        {query.error
          ? "额度暂不可用"
          : query.data
            ? query.data.available === null
              ? "每日图片不限额"
              : `今日可用 ${query.data.available} 张`
            : "额度加载中…"}
        {!query.error && !!query.data?.held && (
          <span> · 待结算 {query.data.held} 张</span>
        )}
      </Button>
    </Popover>
  );
}
