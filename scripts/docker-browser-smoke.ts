import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const auth = JSON.parse(
  await readFile(".codex-temp/docker-login.json", "utf8"),
);
const browser = await chromium.launch({ channel: "chromium" });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|style-src|script-src/i.test(m.text())
    )
      errors.push(m.text().slice(0, 140));
  });
  const response = await page.goto("http://127.0.0.1:8792/login");
  assert.match(
    response!.headers()["content-security-policy"],
    /style-src[^;]*nonce-/,
  );
  await page.getByLabel("账号", { exact: true }).fill(auth.username);
  await page.getByLabel("密码", { exact: true }).fill(auth.password);
  const login = page.getByRole("button", { name: "登录", exact: true });
  assert.equal(
    await login.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(0, 98, 176)",
  );
  await login.click();
  await page.getByRole("heading", { name: "我的项目", exact: true }).waitFor();
  await page
    .getByRole("link", { name: /Docker synthetic acceptance/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "提交图片任务", exact: true })
    .waitFor();
  await page.locator(".quota-details summary").waitFor();
  const submit = await page
    .getByRole("button", { name: "提交图片任务", exact: true })
    .boundingBox();
  const quota = await page.locator(".quota-details summary").boundingBox();
  assert(submit && quota && submit.y + submit.height <= quota.y);
  await page.getByLabel("图片模型").click();
  await page.locator(".ant-select-dropdown:visible").waitFor();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: ".codex-temp/docker-stage2-workbench.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "账号管理", exact: true }).click();
  await page
    .getByRole("button", { name: "重新生成链接", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Built Docker Chromium: nonce styles, themed button, Select popup, confirmation dialog and medium/large desktop layout passed",
  );
} finally {
  await browser.close();
}
