import { test, expect } from "@playwright/test";
test("artwork previews keep asset metadata and selection when polling prepends or removes images", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    executionVersion: 1,
    username: "synthetic-admin",
    role: "admin",
    enabled: true,
    activated: true,
  };
  const item = (id: number, model: string) => ({
    id: `00000000-0000-4000-8000-00000000000${id}`,
    model,
    width: id * 128,
    height: 512,
    createdAt: `2026-11-02T01:0${id}:00Z`,
  });
  const a = item(3, "MODEL-A"),
    b = item(4, "MODEL-B"),
    c = item(5, "MODEL-C"),
    d = item(6, "MODEL-D");
  let artworks = [a, b];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR4kAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/auth/me") body = { user, csrfToken: "synthetic-csrf" };
    else if (path === "/api/admin/users")
      body = {
        users: [
          {
            ...user,
            today: {
              day: "2026-11-02",
              images: { used: 2, held: 0, limit: 100, earlierHeld: 0 },
              planning: { used: 0, held: 0, limit: 50, earlierHeld: 0 },
            },
          },
        ],
        hasMore: false,
      };
    else if (path.endsWith("/artworks")) body = { artworks, hasMore: false };
    else if (/artworks[/][^/]+[/](preview|original)$/.test(path)) {
      await route.fulfill({ status: 200, contentType: "image/png", body: png });
      return;
    } else if (path === "/api/projects")
      body = { projects: [], hasMore: false };
    else if (path === "/api/images/usage")
      body = {
        day: "2026-11-02",
        used: 0,
        held: 0,
        available: 100,
        earlierHeld: 0,
        attempts: 0,
        storageUsed: 0,
        storageReserved: 0,
        models: [],
        capabilities: [],
        providerMode: null,
        policy: {
          imageLimit: 100,
          attemptsLimit: 300,
          storageLimit: 2147483648,
        },
      };
    else body = { state: "none" };
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto("/admin/users");
  await page
    .getByRole("button", { name: "查看今日 2 张图片", exact: true })
    .click();
  await expect(page.locator(".admin-artworks img")).toHaveCount(2);
  const image = page.locator(".ant-image-preview-img"),
    meta = page.locator(".admin-artwork-meta");
  await page.locator(".admin-artworks img").nth(1).click();
  await expect(image).toHaveAttribute("src", new RegExp(`${b.id}/original$`));
  await expect(meta).toContainText("MODEL-B · 512 × 512");
  await page.keyboard.press("Escape");
  await expect(image).toBeHidden();
  await page.locator(".admin-artworks img").first().click();
  await expect(image).toHaveAttribute("src", new RegExp(`${a.id}/original$`));
  await expect(meta).toContainText("MODEL-A · 384 × 512");
  await page.keyboard.press("Escape");
  await expect(image).toBeHidden();
  artworks = [c, a, b];
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".admin-artworks img")).toHaveCount(3);
  await page.locator(".admin-artworks img").nth(2).click();
  await expect(image).toHaveAttribute("src", new RegExp(`${b.id}/original$`));
  await expect(meta).toContainText("MODEL-B · 512 × 512");
  await page.keyboard.press("Escape");
  await expect(image).toBeHidden();
  await page.locator(".admin-artworks img").first().click();
  await expect(image).toHaveAttribute("src", new RegExp(`${c.id}/original$`));
  await expect(meta).toContainText("MODEL-C · 640 × 512");
  await page.keyboard.press("ArrowRight");
  await expect(image).toHaveAttribute("src", new RegExp(`${a.id}/original$`));
  await expect(meta).toContainText("MODEL-A · 384 × 512");
  await page.keyboard.press("ArrowLeft");
  artworks = [d, c, a, b];
  await page.clock.runFor(16000);
  await expect(page.locator(".admin-artworks img")).toHaveCount(4);
  await expect(image).toHaveAttribute("src", new RegExp(`${c.id}/original$`));
  await expect(meta).toContainText("MODEL-C · 640 × 512");
  artworks = [d, a, b];
  await page.clock.runFor(16000);
  await expect(page.locator(".admin-artworks img")).toHaveCount(3);
  await expect(image).toBeHidden();
  await expect(page.locator(".user-settings-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".user-settings-drawer")).toBeHidden();
});
