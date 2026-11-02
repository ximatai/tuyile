import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  AdminArtworksPage,
  AdminQuota,
  UserView,
} from "@tuyile/contracts";
import { Button, Image, Notice } from "@tuyile/ui";
import { HelpPopover } from "./interface-help";
import { client } from "./api";
import { useSessionState } from "./session-state";
export function QuotaCount({
  quota,
  onUsedClick,
}: {
  quota?: AdminQuota;
  onUsedClick?: () => void;
}) {
  if (!quota) return <>—</>;
  return (
    <>
      {quota.used > 0 && onUsedClick ? (
        <Button
          type="button"
          variant="link"
          onClick={onUsedClick}
          aria-label={`查看今日 ${quota.used} 张图片`}
          className="admin-quota-link"
        >
          {quota.used}
        </Button>
      ) : (
        quota.used
      )}{" "}
      / {quota.limit === -1 ? "不限额" : quota.limit}
      {quota.held > 0 && (
        <small className="admin-held">预留 {quota.held}</small>
      )}
    </>
  );
}
export function UserActivity({
  user,
  onPreviewChange,
  artworksOnly = false,
}: {
  user: UserView;
  artworksOnly?: boolean;
  onPreviewChange: (open: boolean) => void;
}) {
  const state = useSessionState();
  const query = useInfiniteQuery({
    queryKey: state.key("admin-artworks", user.id),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      client(state.session.csrfToken)<AdminArtworksPage>(
        `/admin/users/${user.id}/artworks?offset=${pageParam}`,
        undefined,
        signal,
      ),
    getNextPageParam: (page, pages) =>
      page.hasMore ? pages.length * 5 : undefined,
    refetchInterval: 15000,
  });
  const artworks = [
    ...new Map(
      (query.data?.pages.flatMap((p) => p.artworks) ?? []).map((a) => [
        a.id,
        a,
      ]),
    ).values(),
  ];
  useEffect(() => {
    if (!artworks.length) onPreviewChange(false);
  }, [artworks.length, onPreviewChange]);
  useEffect(() => () => onPreviewChange(false), [onPreviewChange]);
  return (
    <>
      {!artworksOnly && (
        <>
          <div className="admin-usage-title">
            <h3>今日额度</h3>
            <HelpPopover title="统计口径">
              上海时间每日 00:00
              切换。额度按预留所属日结算，作品按成功保存时间展示。跨日完成可能使两者数量不同；删除作品不返还次数。
            </HelpPopover>
          </div>
          {user.today && (
            <div className="admin-user-quotas">
              {(
                [
                  ["图片", user.today.images],
                  ["规划", user.today.planning],
                ] as const
              ).map(([label, q]) => (
                <div key={label}>
                  <span>{label}</span>
                  <span>
                    <QuotaCount quota={q} />
                  </span>
                  <span>
                    {q.limit === -1
                      ? ""
                      : `剩余 ${Math.max(0, q.limit - q.used - q.held)}`}
                  </span>
                  {q.earlierHeld > 0 && <small>历史预留 {q.earlierHeld}</small>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="admin-usage-title">
        <h3>今日作品</h3>
        <Button
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新
        </Button>
      </div>
      {query.error && <Notice error>{query.error.message}</Notice>}
      {query.isPending ? (
        <p role="status">正在加载…</p>
      ) : !artworks.length ? (
        <p className="hint">今日暂无作品</p>
      ) : (
        <div className="admin-artworks">
          <Image.PreviewGroup
            preview={{
              onOpenChange: onPreviewChange,
              imageRender: (node, { current }) => (
                <>
                  {node}
                  <div className="admin-artwork-meta">
                    {artworks[current] &&
                      `${artworks[current].model} · ${artworks[current].width} × ${artworks[current].height} · ${new Date(artworks[current].createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`}
                  </div>
                </>
              ),
            }}
          >
            {artworks.map((a) => (
              <Image
                key={a.id}
                alt={`${a.model} · ${a.width} × ${a.height} · ${new Date(a.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`}
                src={`/api/admin/users/${user.id}/artworks/${a.id}/preview`}
                preview={{
                  src: `/api/admin/users/${user.id}/artworks/${a.id}/original`,
                }}
              />
            ))}
          </Image.PreviewGroup>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多
        </Button>
      )}
    </>
  );
}
