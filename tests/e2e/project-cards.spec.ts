import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
test("project cards show zero, one, two and stacked generated covers with create and delete controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const administrator = await (await page.request.get("/api/auth/me")).json();
  const origin = "http://127.0.0.1:5180";
  const issued = await (
    await page.request.post("/api/admin/users", {
      headers: { Origin: origin, "X-CSRF-Token": administrator.csrfToken },
      data: { username: `cards-${randomUUID().slice(0, 8)}` },
    })
  ).json();
  const temporary = await (
    await page.request.post("/api/auth/login", {
      headers: { Origin: origin },
      data: {
        username: issued.user.username,
        password: issued.temporaryPassword,
      },
    })
  ).json();
  const password = `Cards-${randomUUID()}`;
  expect(
    (
      await page.request.post("/api/auth/password", {
        headers: { Origin: origin, "X-CSRF-Token": temporary.csrfToken },
        data: { currentPassword: issued.temporaryPassword, password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers: { Origin: origin },
        data: { username: issued.user.username, password },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建项目", exact: true });
  await modal.getByLabel("项目名称").fill("空白项目");
  await modal.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(modal).toBeHidden();
  const usage = await (await page.request.get("/api/images/usage")).json();
  const choice = usage.modelOptions?.[0];
  const projects: { id: string; name: string; count: number }[] = [];
  for (const [count, name] of [
    [1, "山间咖啡"],
    [2, "包装探索"],
    [3, "夏日海报"],
    [4, "品牌视觉合集"],
  ] as const) {
    const project = await (
      await page.request.post("/api/projects", { headers, data: { name } })
    ).json();
    projects.push({ ...project, count });
    const response = await page.request.post("/api/images/tasks", {
      headers,
      data: {
        projectId: project.id,
        requestKey: randomUUID(),
        prompt: "Synthetic project card",
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
    expect(response.ok()).toBe(true);
    const task = await response.json();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/images/tasks/${task.id}`)
            ).json()
          ).state,
        { timeout: 20000 },
      )
      .toBe("succeeded");
  }
  await page.reload();
  for (const p of projects) {
    const card = page.locator(".project-card").filter({ hasText: p.name });
    await expect(card.locator("img")).toHaveCount(Math.min(3, p.count));
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluateAll((imgs: HTMLImageElement[]) =>
            imgs.every((i) => i.naturalWidth > 0),
          ),
      )
      .toBe(true);
  }
  await expect(
    page
      .locator(".project-card")
      .filter({ hasText: "空白项目" })
      .locator("img"),
  ).toHaveCount(0);
  await page.screenshot({ path: ".codex-temp/project-cards-1440.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: ".codex-temp/project-cards-1920.png" });
  await page
    .getByRole("button", { name: "项目操作 空白项目", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除项目", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "请确认" });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.locator(".project-card").filter({ hasText: "空白项目" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "项目操作 空白项目", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "项目操作 空白项目", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除项目", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.locator(".project-card").filter({ hasText: "空白项目" }),
  ).toHaveCount(0);
  await page
    .locator(".project-card")
    .filter({ hasText: "品牌视觉合集" })
    .click();
  await expect(
    page.getByRole("heading", { name: "品牌视觉合集", exact: true }),
  ).toBeVisible();
});
