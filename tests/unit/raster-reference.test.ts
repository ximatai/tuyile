import { it, expect, vi } from "vitest";
import { rasterReferences } from "../../apps/web/src/raster-reference";
it("converts four vector references within renderer concurrency and preserves order, while cancellation creates nothing", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const fetcher = vi.fn(async (url: any, options: any) => {
    const id = String(url)
      .split("/")
      .at(options?.method === "POST" ? -2 : -1)!;
    if (options?.method !== "POST")
      return Response.json({ id, mime: "image/svg+xml" });
    active++;
    peak = Math.max(peak, active);
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return Response.json({ id: `png-${id}` });
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const ids = ["a", "b", "c", "d"];
    expect(
      await rasterReferences("synthetic", ids, async () => false),
    ).toBeNull();
    expect(calls).toBe(0);
    expect(await rasterReferences("synthetic", ids, async () => true)).toEqual(
      ids.map((id) => `png-${id}`),
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(calls).toBe(4);
  } finally {
    vi.unstubAllGlobals();
  }
});
