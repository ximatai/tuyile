import type { Hono } from "hono";
import {
  AppError,
  type LibraryService,
  type CreationService,
} from "@tuyile/core";
import {
  favoriteInput,
  promptTemplateInput,
  id,
  libraryExportInput,
  pageOffset,
  z,
} from "@tuyile/contracts";
import { zipSync } from "fflate";
import type { ApiEnv } from "./app.js";
export function libraryRoutes(
  app: Hono<ApiEnv>,
  library: LibraryService,
  creation: CreationService,
) {
  app.get("/api/library/assets", async (c) => {
    const rows = await library.assets(
      c.get("session").user,
      pageOffset.parse(c.req.query("offset")),
    );
    return c.json({ assets: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get("/api/library/favorites", async (c) => {
    const rows = await library.favorites(
      c.get("session").user,
      pageOffset.parse(c.req.query("offset")),
      z.string().max(60).optional().parse(c.req.query("group")),
    );
    return c.json({ favorites: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get("/api/library/groups", async (c) =>
    c.json({ groups: await library.groups(c.get("session").user) }),
  );
  app.get("/api/library/prompts", async (c) => {
    return c.json(
      await library.promptPage(
        c.get("session").user,
        pageOffset.parse(c.req.query("offset")),
        c.req.queries("category") ?? [],
      ),
    );
  });
  app.get("/api/admin/prompts", async (c) => {
    const rows = await library.managedPrompts(
      c.get("session").user,
      pageOffset.parse(c.req.query("offset")),
      z.string().trim().max(100).default("").parse(c.req.query("search")),
    );
    return c.json({ prompts: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post("/api/admin/prompts", async (c) =>
    c.json(
      await library.savePrompt(
        c.get("session").user,
        promptTemplateInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/library/favorites", async (c) =>
    c.json(
      await library.saveFavorite(
        c.get("session").user,
        favoriteInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post("/api/library/favorites/:id/delete", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    await library.removeFavorite(
      c.get("session").user,
      id.parse(c.req.param("id")),
    );
    return c.json({ ok: true });
  });
  app.get("/api/library/assets/:id/references", async (c) =>
    c.json({
      references: await library.references(
        c.get("session").user,
        id.parse(c.req.param("id")),
      ),
    }),
  );
  app.post("/api/library/export", async (c) => {
    const { assetIds } = libraryExportInput.parse(await c.req.json()),
      p = c.get("session").user,
      ids = [...new Set(assetIds)];
    const metadata = await Promise.all(ids.map((id) => creation.asset(p, id)));
    if (metadata.reduce((n, a) => n + a.bytes, 0) > 50 * 1024 * 1024)
      throw new AppError("EXPORT_LIMIT", 413);
    const files: Record<string, Uint8Array> = {};
    let size = 0;
    for (const id of ids) {
      const image = await creation.bytes(p, id);
      size += image.bytes.length;
      if (size > 50 * 1024 * 1024) throw new AppError("EXPORT_LIMIT", 413);
      const extension =
        image.asset.mime === "image/jpeg"
          ? "jpg"
          : image.asset.mime === "image/webp"
            ? "webp"
            : "png";
      files[`${id}.${extension}`] = image.bytes;
    }
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", 'attachment; filename="tuyile-images.zip"');
    return c.body(zipSync(files, { level: 0 }));
  });
}
