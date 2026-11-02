import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
test("user management shows mock generation quota and artwork previews", async ({
  page,
  playwright,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const administrator = await (await page.request.get("/api/auth/me")).json();
  const origin = "http://127.0.0.1:5180";
  const issuedResponse = await page.request.post("/api/admin/users", {
    headers: { Origin: origin, "X-CSRF-Token": administrator.csrfToken },
    data: { username: `usage-${randomUUID().slice(0, 8)}` },
  });
  expect(issuedResponse.ok()).toBe(true);
  const issued = await issuedResponse.json();
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const temporary = await (
    await member.post("/api/auth/login", {
      data: {
        username: issued.user.username,
        password: issued.temporaryPassword,
      },
    })
  ).json();
  const password = `Usage-${randomUUID()}`;
  expect(
    (
      await member.post("/api/auth/password", {
        headers: { "X-CSRF-Token": temporary.csrfToken },
        data: { currentPassword: issued.temporaryPassword, password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await member.post("/api/auth/login", {
        data: { username: issued.user.username, password },
      })
    ).ok(),
  ).toBe(true);
  const session = await (await member.get("/api/auth/me")).json();
  await page.goto("/admin/users");
  await page
    .getByRole("textbox", { name: "搜索用户", exact: true })
    .fill(session.user.username);
  await expect(
    page.getByRole("cell", { name: session.user.username, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "今日图片", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /查看今日 \d+ 张图片/ }),
  ).toHaveCount(0);
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  try {
    const project = await (
      await member.post("/api/projects", {
        headers,
        data: { name: "额度作品-" + randomUUID().slice(0, 8) },
      })
    ).json();
    const usage = await (await member.get("/api/images/usage")).json();
    const choice = usage.modelOptions?.[0];
    for (const count of [4, 2]) {
      const submitted = await member.post("/api/images/tasks", {
        headers,
        data: {
          projectId: project.id,
          requestKey: randomUUID(),
          prompt: "Synthetic blue artwork",
          model: choice?.modelId ?? usage.models[0],
          ...(choice ? { modelSelectionId: choice.id } : {}),
          width: 256,
          height: 256,
          quality: "medium",
          format: "png",
          count,
          referenceIds: [],
        },
      });
      expect(submitted.ok()).toBe(true);
      const task = await submitted.json();
      await expect
        .poll(
          async () =>
            (await (await member.get(`/api/images/tasks/${task.id}`)).json())
              .state,
          { timeout: 20000 },
        )
        .toBe("succeeded");
    }
  } finally {
    await member.dispose();
  }
  await page.goto("/admin/users");
  await page
    .getByRole("textbox", { name: "搜索用户", exact: true })
    .fill(session.user.username);
  await expect(
    page.getByRole("cell", { name: session.user.username, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "今日图片", exact: true }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: session.user.username, exact: true }),
  });
  await row
    .getByRole("button", { name: "查看今日 6 张图片", exact: true })
    .click();
  const drawer = page.locator(".user-settings-drawer");
  await expect(
    drawer.getByRole("heading", { name: "今日作品", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "今日额度", exact: true }),
  ).toHaveCount(0);
  await expect(drawer.locator(".admin-artworks .ant-image-img")).toHaveCount(5);
  const firstPage = await (
    await page.request.get(`/api/admin/users/${session.user.id}/artworks`)
  ).json();
  expect(firstPage.artworks).toHaveLength(5);
  expect(firstPage.hasMore).toBe(true);
  expect(
    firstPage.artworks.map((a: { createdAt: string }) => a.createdAt),
  ).toEqual(
    [...firstPage.artworks]
      .map((a: { createdAt: string }) => a.createdAt)
      .sort()
      .reverse(),
  );
  await drawer.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(drawer.locator(".admin-artworks .ant-image-img")).toHaveCount(6);
  await expect(
    drawer.getByRole("button", { name: "加载更多", exact: true }),
  ).toHaveCount(0);
  const image = drawer.locator(".admin-artworks .ant-image-img").first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await image.click();
  await expect(page.locator(".ant-image-preview-img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview-img")).toBeHidden();
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: ".codex-temp/admin-user-activity-1440.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: ".codex-temp/admin-user-activity-1920.png" });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await row.getByRole("button", { name: "查看", exact: true }).click();
  await expect(
    drawer.getByRole("heading", { name: "使用额度", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "今日作品", exact: true }),
  ).toHaveCount(0);
  await expect(drawer.locator(".ant-collapse")).toHaveCount(0);
  await expect(
    drawer.getByLabel("图片最大边长（px）", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return box
        ? Math.abs(box.x + box.width - page.viewportSize()!.width)
        : Infinity;
    })
    .toBeLessThan(1);
  await page.screenshot({ path: ".codex-temp/user-settings-flat.png" });
  // A previous-day reservation can finish today without consuming today's quota.
  await page.route("**/api/admin/users?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const user of body.users)
      if (user.id === session.user.id) user.today.images.used = 0;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await page
    .getByRole("textbox", { name: "搜索用户", exact: true })
    .fill(session.user.username);
  const zeroRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: session.user.username, exact: true }),
  });
  await expect(zeroRow).toContainText("0 / 100");
  await expect(zeroRow.getByRole("button", { name: /查看今日/ })).toHaveCount(
    0,
  );
  await zeroRow.getByRole("button", { name: "查看", exact: true }).click();
  await page.getByRole("button", { name: "更多账号操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "今日作品", exact: true }).click();
  await expect(drawer.locator(".admin-artworks .ant-image-img")).toHaveCount(5);
  await drawer.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(drawer.locator(".admin-artworks .ant-image-img")).toHaveCount(6);
  await page.getByRole("button", { name: "更多账号操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "账号设置", exact: true }).click();
  await expect(
    drawer.getByRole("heading", { name: "使用额度", exact: true }),
  ).toBeVisible();
  const quota = drawer.getByLabel("每日图片额度", { exact: true });
  await quota.fill("99");
  await page.getByRole("button", { name: "更多账号操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "今日作品", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(quota).toHaveValue("99");
  await quota.fill("100");
  const art = await (
    await page.request.get(`/api/admin/users/${session.user.id}/artworks`)
  ).json();
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5180",
  });
  expect(
    (
      await anonymous.get(
        `/api/admin/users/${session.user.id}/artworks/${art.artworks[0].id}/preview`,
      )
    ).status(),
  ).toBe(401);
  await anonymous.dispose();
});
