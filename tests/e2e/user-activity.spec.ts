import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
test("user management shows mock generation quota and artwork previews", async ({
  page,
  playwright,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: "额度作品-" + randomUUID().slice(0, 8) },
    })
  ).json();
  const usage = await (await page.request.get("/api/images/usage")).json();
  const choice = usage.modelOptions?.[0];
  const submitted = await page.request.post("/api/images/tasks", {
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
      count: 1,
      referenceIds: [],
    },
  });
  expect(submitted.ok()).toBe(true);
  const task = await submitted.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/images/tasks/${task.id}`)).json())
          .state,
    )
    .toBe("succeeded");
  await page.goto("/admin/users");
  await expect(
    page.getByRole("columnheader", { name: "今日图片", exact: true }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: session.user.username, exact: true }),
  });
  await row.getByRole("button", { name: "查看", exact: true }).click();
  const drawer = page.locator(".user-settings-drawer");
  await expect(
    drawer.getByRole("heading", { name: "今日作品", exact: true }),
  ).toBeVisible();
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
