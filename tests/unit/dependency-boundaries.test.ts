import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
async function sources(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (e) =>
        e.isDirectory()
          ? sources(join(root, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(root, e.name)]
            : [],
      ),
    )
  ).flat();
}
it("keeps core independent of adapters and web independent of server secrets", async () => {
  for (const root of ["packages/core/src", "apps/web/src"])
    for (const path of await sources(root)) {
      const text = await readFile(path, "utf8");
      const imports = [
        ...text.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g),
      ].map((m) => m[1]);
      for (const name of imports) {
        expect(name, `${path}: ${name}`).not.toMatch(
          /@tuyile\/infrastructure|(?:^|\/)pg$|hono|apps\/(?:api|worker)/,
        );
        if (root.startsWith("apps"))
          expect(name, path).not.toMatch(/@tuyile\/core|provider-config/);
      }
    }
});
