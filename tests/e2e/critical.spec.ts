import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
import { ensureTestPlanner } from "../planner-fixture";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginAdmin(page);
});

test("critical: generation persists and private images require authentication", async ({
  page,
  playwright,
}) => {
  const session = await (await page.request.get("/api/auth/me")).json();
  const projectResponse = await page.request.post("/api/projects", {
    headers: {
      Origin: "http://127.0.0.1:5180",
      "X-CSRF-Token": session.csrfToken,
    },
    data: { name: "关键生图-" + randomUUID().slice(0, 8) },
  });
  expect(projectResponse.ok()).toBe(true);
  const project = await projectResponse.json();
  await page.goto(`/projects/${project.id}`);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const png = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
  })
    .png()
    .toBuffer();
  await page
    .getByTestId("reference-upload")
    .locator("input[type=file]")
    .setInputFiles({
      name: "critical-reference.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(
    page
      .getByTestId("reference-upload")
      .getByRole("img", { name: "critical-reference.png", exact: true }),
  ).toBeVisible();

  await page
    .getByLabel("创作需求", { exact: true })
    .fill("关键链路：合成测试海报");
  const submitted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/images/tasks") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(202);
  const task = await response.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/images/tasks/${task.id}`)).json())
          .state,
      { timeout: 20000 },
    )
    .toBe("succeeded");
  const complete = await (
    await page.request.get(`/api/images/tasks/${task.id}`)
  ).json();
  expect(complete.settings.referenceIds).toHaveLength(1);
  expect(complete.used).toBe(1);
  expect(complete.held).toBe(0);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  await page.reload();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  const original = `/api/images/assets/${complete.outputs[0].id}/original`;
  expect((await page.request.get(original)).status()).toBe(200);
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5180",
  });
  try {
    expect((await anonymous.get(original)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test("critical: Agent planning requires confirmation before generation", async ({
  page,
}) => {
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  await ensureTestPlanner(page, "critical-planner");
  const response = await page.request.post("/api/projects", {
    headers,
    data: { name: "关键规划-" + randomUUID().slice(0, 8) },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
  await page
    .getByLabel("告诉 Agent 你的想法", { exact: true })
    .fill("用简洁插画设计咖啡海报，直接给出一个方案。");
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认执行", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/images/tasks?projectId=${project.id}`)
          ).json()
        ).tasks.filter((t: { state: string }) => t.state === "succeeded")
          .length,
      { timeout: 20000 },
    )
    .toBe(1);
});

test("critical: activated members cannot access administration or another workspace", async ({
  page,
  browser,
}) => {
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const response = await page.request.post("/api/admin/users", {
    headers,
    data: { username: "smoke_" + randomUUID().slice(0, 8) },
  });
  expect(response.status()).toBe(201);
  const issued = await response.json();
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: "私有工作区" },
    })
  ).json();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5180",
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const member = await context.newPage();
    async function signIn(password: string) {
      await member.goto("/login");
      await member
        .getByLabel("账号", { exact: true })
        .fill(issued.user.username);
      await member.getByLabel("密码", { exact: true }).fill(password);
      await member.getByRole("button", { name: "登录", exact: true }).click();
    }
    await signIn(issued.temporaryPassword);
    await expect(
      member.getByRole("heading", { name: "设置自己的密码", exact: true }),
    ).toBeVisible();
    expect((await member.request.get("/api/projects")).status()).toBe(403);
    const password = "Synthetic!" + randomUUID();
    await member
      .getByLabel("临时密码", { exact: true })
      .fill(issued.temporaryPassword);
    await member.getByLabel("新密码", { exact: true }).fill(password);
    await member.getByLabel("确认新密码", { exact: true }).fill(password);
    await member
      .getByRole("button", { name: "保存并重新登录", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: "登录图一乐", exact: true }),
    ).toBeVisible();
    await signIn(password);
    await expect(
      member.getByRole("heading", { name: "我的项目", exact: true }),
    ).toBeVisible();
    for (const name of ["用户管理", "模型服务"])
      await expect(member.getByRole("link", { name, exact: true })).toHaveCount(
        0,
      );
    expect((await member.request.get("/api/admin/users")).status()).toBe(403);
    expect(
      (await member.request.get("/api/model-admin/catalog")).status(),
    ).toBe(403);
    expect(
      (await member.request.get(`/api/projects/${project.id}/canvas`)).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});
