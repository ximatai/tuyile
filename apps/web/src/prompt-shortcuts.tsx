import { useEffect, useRef, useState, type ComponentRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PromptPickerPage } from "@tuyile/contracts";
import { Button, ChoiceField, Input, Notice, Popover, Tabs } from "@tuyile/ui";
import { ChevronDown, Search } from "lucide-react";
import { client } from "./api";
import { useSessionState } from "./session-state";
import { Excerpt } from "./interface-help";
export function PromptShortcuts({
  onChoose,
  visible = true,
}: {
  onChoose: (prompt: string) => Promise<boolean>;
  visible?: boolean;
}) {
  const state = useSessionState(),
    api = client(state.session.csrfToken);
  const [open, setOpen] = useState(false),
    [source, setSource] = useState<"favorites" | "recommended">("favorites"),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [group, setGroup] = useState<string>(),
    [choosing, setChoosing] = useState(false);
  const trigger = useRef<ComponentRef<typeof Button>>(null),
    selecting = useRef(false);
  const favorites = useQuery({
    queryKey: state.key("prompt-shortcuts", "favorites"),
    queryFn: ({ signal }) =>
      api<PromptPickerPage>(
        "/library/prompt-picker?source=favorites",
        undefined,
        signal,
      ),
    refetchInterval: 15000,
  });
  const recommended = useQuery({
    queryKey: state.key("prompt-shortcuts", "recommended"),
    queryFn: ({ signal }) =>
      api<PromptPickerPage>(
        "/library/prompt-picker?source=recommended",
        undefined,
        signal,
      ),
    enabled: favorites.isSuccess && !favorites.data.items.length,
    refetchInterval: 15000,
  });
  const shortcuts = favorites.data?.items.length
    ? favorites.data.items
    : favorites.isSuccess
      ? recommended.data?.items
      : [];
  const query = useInfiniteQuery({
    queryKey: state.key(
      "prompt-picker",
      source,
      term,
      group === undefined ? "all" : `group:${group}`,
    ),
    initialPageParam: 0,
    staleTime: 0,
    enabled: open,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({
        source,
        search: term,
        offset: String(pageParam),
      });
      if (group !== undefined) params.set("group", group);
      return api<PromptPickerPage>(
        `/library/prompt-picker?${params}`,
        undefined,
        signal,
      );
    },
    getNextPageParam: (p, pages) => (p.hasMore ? pages.length * 50 : undefined),
  });
  const items = [
    ...new Map(
      (query.data?.pages.flatMap((p) => p.items) ?? []).map((p) => [p.id, p]),
    ).values(),
  ];
  const groups = query.data?.pages[0]?.groups ?? [];
  const showGroups = groups.length > 1 || group !== undefined;
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  function resetFilters() {
    setSearch("");
    setTerm("");
    setGroup(undefined);
  }
  function toggle(next: boolean) {
    if (choosing) return;
    if (next) {
      resetFilters();
      setSource(
        favorites.isSuccess && !favorites.data.items.length
          ? "recommended"
          : "favorites",
      );
    }
    setOpen(next);
  }
  async function choose(prompt: string) {
    if (selecting.current) return;
    selecting.current = true;
    setChoosing(true);
    try {
      if (await onChoose(prompt)) setOpen(false);
    } finally {
      selecting.current = false;
      setChoosing(false);
    }
  }
  return (
    <div className="prompt-shortcuts" role="group" aria-label="快捷提示词">
      {(shortcuts ?? []).slice(0, 3).map((item) => (
        <Button
          key={item.id}
          type="button"
          className="prompt-shortcut"
          disabled={choosing}
          onClick={() => void choose(item.prompt)}
        >
          {item.title}
        </Button>
      ))}
      <Popover
        trigger="click"
        placement="leftTop"
        open={open}
        onOpenChange={toggle}
        classNames={{ root: "prompt-picker-popover" }}
        content={
          <div
            className="prompt-picker"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (!choosing) {
                  setOpen(false);
                  trigger.current?.focus();
                }
              }
            }}
          >
            <Tabs
              activeKey={source}
              onChange={(key) => {
                setSource(key as typeof source);
                resetFilters();
              }}
              items={[
                { key: "favorites", label: "我的收藏" },
                { key: "recommended", label: "公共提示词" },
              ]}
            />
            <div
              className={`prompt-picker-filters${showGroups ? "" : " single-filter"}`}
            >
              <Input
                aria-label="搜索提示词"
                placeholder="搜索提示词"
                prefix={<Search size={14} />}
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {showGroups && (
                <ChoiceField
                  hideLabel
                  label={source === "favorites" ? "收藏分组" : "公共分类"}
                  value={group === undefined ? "all" : `group:${group}`}
                  onValueChange={(value) =>
                    setGroup(value === "all" ? undefined : value.slice(6))
                  }
                  options={[
                    {
                      value: "all",
                      label: source === "favorites" ? "全部分组" : "全部分类",
                    },
                    ...groups.map((g) => ({
                      value: `group:${g}`,
                      label: g || "未分组",
                    })),
                  ]}
                />
              )}
            </div>
            <div
              className="prompt-picker-results"
              role="region"
              aria-label="可选提示词"
            >
              {query.isPending && <p role="status">正在加载…</p>}
              {query.error && <Notice error>{query.error.message}</Notice>}
              {!query.isPending && !query.error && !items.length && (
                <p className="hint">
                  {search || group !== undefined
                    ? "没有匹配的提示词"
                    : source === "favorites"
                      ? "还没有收藏提示词"
                      : "暂无公共提示词"}
                </p>
              )}
              {items.map((item) => (
                <article key={item.id} className="prompt-picker-item">
                  <Button
                    type="button"
                    className="prompt-picker-choice"
                    aria-label={`选用 ${item.title}`}
                    disabled={choosing}
                    onClick={() => void choose(item.prompt)}
                  >
                    <span className="prompt-picker-item-heading">
                      <strong>{item.title}</strong>
                      {item.groupName &&
                        groups.length > 1 &&
                        group === undefined && (
                          <span className="hint">{item.groupName}</span>
                        )}
                    </span>
                  </Button>
                  <Excerpt rows={2}>{item.prompt}</Excerpt>
                </article>
              ))}
              {query.hasNextPage && (
                <Button
                  type="button"
                  disabled={query.isFetchingNextPage}
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  加载更多
                </Button>
              )}
              {query.error && (
                <Button type="button" onClick={() => void query.refetch()}>
                  重试
                </Button>
              )}
            </div>
          </div>
        }
      >
        <Button
          ref={trigger}
          type="button"
          className="prompt-shortcuts-more"
          aria-label="更多提示词"
          aria-expanded={open}
          disabled={choosing || favorites.isPending}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          更多
          <ChevronDown size={13} />
        </Button>
      </Popover>
    </div>
  );
}
