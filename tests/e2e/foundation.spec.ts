import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const auth = JSON.parse(
  await readFile(".codex-temp/e2e-auth.json", "utf8"),
) as { username: string; password: string };
async function login(
  page: Page,
  name = auth.username,
  password = auth.password,
) {
  await page.goto("/login");
  await page.getByLabel("账号", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的项目" })).toBeVisible();
}
test("desktop and mobile: persistent projects, activation, account boundaries and password revocation", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByLabel("项目名称").fill("品牌视觉方案");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name: /品牌视觉方案/ }).click();
  await expect(
    page.getByRole("heading", { name: "品牌视觉方案" }),
  ).toBeVisible();
  const adminProjectUrl = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "品牌视觉方案" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "账号管理", exact: true }).click();
  await page.getByLabel("新账号").fill("designer01");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const activation = await page.getByLabel("复制交付链接").inputValue();
  await expect(
    page.getByRole("row").filter({ hasText: "designer01" }),
  ).toContainText("待激活");
  await page.screenshot({
    path: ".codex-temp/stage1-desktop-admin.png",
    fullPage: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const member = await context.newPage();
  const newPassword = randomBytes(24).toString("base64url");
  await member.goto(activation);
  await expect(member.getByRole("heading", { name: "激活账号" })).toBeVisible();
  await expect(member).toHaveURL(/\/login$/);
  await member.getByLabel("新密码", { exact: true }).fill(newPassword);
  await member.getByLabel("确认新密码").fill(newPassword);
  await member.getByRole("button", { name: "保存密码" }).click();
  await expect(member.getByText("密码已设置，请登录。")).toBeVisible();
  await member.getByLabel("账号", { exact: true }).fill("designer01");
  await member.getByLabel("密码", { exact: true }).fill(newPassword);
  await member.getByRole("button", { name: "登录", exact: true }).click();
  await expect(member.getByRole("heading", { name: "我的项目" })).toBeVisible();
  await expect(
    member.getByRole("link", { name: "账号管理", exact: true }),
  ).toHaveCount(0);
  await expect(member.getByText("从第一个项目开始")).toBeVisible();
  await member.getByLabel("项目名称").fill("我的插画");
  await member.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(member.getByRole("heading", { name: "我的插画" })).toBeVisible();
  await member.screenshot({
    path: ".codex-temp/stage1-mobile-projects.png",
    fullPage: true,
  });
  expect(
    await member.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await member.goto(adminProjectUrl);
  await expect(member.getByRole("alert")).toContainText(
    "内容不存在或你无权访问",
  );
  await member.getByRole("link", { name: "账户安全", exact: true }).click();
  await member.getByLabel("当前密码").fill(newPassword);
  const changed = randomBytes(24).toString("base64url");
  await member.getByLabel("新密码", { exact: true }).fill(changed);
  await member.getByLabel("确认新密码").fill(changed);
  await member.getByRole("button", { name: "保存并重新登录" }).click();
  await expect(
    member.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await login(member, "designer01", changed);
  const secondTab = await context.newPage();
  await secondTab.goto("http://127.0.0.1:5180/projects");
  await expect(
    secondTab.getByRole("heading", { name: "我的项目" }),
  ).toBeVisible();
  await member.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    secondTab.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await expect(
    member.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "品牌视觉方案" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起导航" }).click();
  await expect(page.getByRole("button", { name: "展开导航" })).toBeVisible();
  await page.screenshot({
    path: ".codex-temp/stage1-desktop-projects.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "账号管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账号管理" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".codex-temp/stage1-mobile-admin.png",
    fullPage: true,
  });
  await context.close();
});

test("same login tab consumes a new activation and then a reset link", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByRole("link", { name: "账号管理", exact: true }).click();
  await page.getByLabel("新账号").fill("hashuser02");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const activation = await page.getByLabel("复制交付链接").inputValue();
  const context = await browser.newContext();
  const member = await context.newPage();
  await member.goto("http://127.0.0.1:5180/login");
  await expect(
    member.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await member.goto(activation);
  await expect(member.getByRole("heading", { name: "激活账号" })).toBeVisible();
  await expect(member).toHaveURL(/\/login$/);
  const first = randomBytes(24).toString("base64url");
  await member.getByLabel("新密码", { exact: true }).fill(first);
  await member.getByLabel("确认新密码").fill(first);
  await member.getByRole("button", { name: "保存密码" }).click();
  await expect(member.getByText("密码已设置，请登录。")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("row")
    .filter({ hasText: "hashuser02" })
    .getByRole("button", { name: "重新生成链接" })
    .click();
  const reset = await page.getByLabel("复制交付链接").inputValue();
  await member.goto(reset);
  await expect(member.getByRole("heading", { name: "重置密码" })).toBeVisible();
  await expect(member).toHaveURL(/\/login$/);
  await expect(member.getByText("密码已设置，请登录。")).toHaveCount(0);
  const second = randomBytes(24).toString("base64url");
  await member.getByLabel("新密码", { exact: true }).fill(second);
  await member.getByLabel("确认新密码").fill(second);
  await member.getByRole("button", { name: "保存密码" }).click();
  await expect(member.getByText("密码已设置，请登录。")).toBeVisible();
  await login(member, "hashuser02", second);
  await context.close();
});
