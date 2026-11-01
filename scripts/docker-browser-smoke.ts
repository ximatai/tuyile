import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const auth = JSON.parse(
  await readFile(".codex-temp/docker-login.json", "utf8"),
);
const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|style-src|script-src/i.test(message.text())
    )
      violations.push(message.text().slice(0, 140));
  });
  const response = await page.goto("http://127.0.0.1:8792/login");
  expect(response?.headers()["content-security-policy"]).toMatch(
    /style-src[^;]*nonce-/,
  );
  await page.getByLabel("账号", { exact: true }).fill(auth.username);
  await page.getByLabel("密码", { exact: true }).fill(auth.password);
  const login = page.getByRole("button", { name: "登录", exact: true });
  await expect(login).toHaveCSS("background-color", "rgb(0, 98, 176)");
  await login.click();
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "修改密码", exact: true }).click();
  const password = page.getByRole("dialog", { name: "修改密码", exact: true });
  await expect(password).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow-y", "hidden");
  await password.getByLabel("当前密码", { exact: true }).press("Escape");
  await expect(password).toBeHidden();
  await page
    .getByRole("link", { name: "Docker synthetic acceptance", exact: true })
    .first()
    .click();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await page.locator(".canvas-image").dblclick();
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await expect(page.locator(".ant-select-dropdown:visible")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "项目", exact: true }).click();
  const deleteTrigger = page.getByRole("button", {
    name: "删除项目 Docker synthetic acceptance",
    exact: true,
  });
  await deleteTrigger.click();
  const confirm = page.getByRole("dialog", { name: "请确认", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  await expect
    .poll(() =>
      page.locator("body").evaluate((el) => getComputedStyle(el).overflowY),
    )
    .not.toBe("hidden");
  expect(violations).toEqual([]);
  console.log(
    "Docker production browser: login, private preview, CSP/nonce controls, modal scroll lock/focus and confirmation passed",
  );
} finally {
  await browser.close();
}
