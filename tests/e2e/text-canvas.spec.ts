import { test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { verifyTextCanvas } from "../text-browser-flow";
test("text canvas editing, linked copy and immutable generation snapshots", async ({
  page,
}) => {
  const auth = JSON.parse(await readFile(".codex-temp/e2e-auth.json", "utf8"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("账号", { exact: true }).fill(auth.username);
  await page.getByLabel("密码", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "我的项目", exact: true }).waitFor();
  await verifyTextCanvas(page);
});
