import { client } from "./api";
/** Every vector-to-raster conversion needs a visible user decision. */
export async function rasterReferences(
  csrf: string,
  ids: string[],
  confirm: (message: string) => Promise<boolean>,
) {
  const api = client(csrf);
  const assets = await Promise.all(
    ids.map((id) =>
      api<{ id: string; mime: string }>(
        `/images/assets/${id}`,
        undefined,
        AbortSignal.timeout(10000),
      ),
    ),
  );
  if (!assets.some((a) => a.mime === "image/svg+xml")) return ids;
  if (
    !(await confirm(
      "所选 SVG 需要转换为 PNG 栅格副本才能修改或用作参考。保留矢量原件；副本占用存储，不增加生图次数。继续转换？",
    ))
  )
    return null;
  const result: string[] = [];
  // Respect the server renderer budget even for a normal four-reference selection.
  for (const a of assets)
    result.push(
      a.mime === "image/svg+xml"
        ? (
            await api<{ id: string }>(
              `/images/assets/${a.id}/raster-copy`,
              {},
              AbortSignal.timeout(10000),
            )
          ).id
        : a.id,
    );
  return result;
}
