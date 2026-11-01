import { expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const sessionPath = ".codex-temp/e2e-admin-session.json";
/** Reuse real cookies for feature tests without repeatedly exercising login rate limits. */
export async function loginAdmin(page: Page) {
  const auth = JSON.parse(await readFile(".codex-temp/e2e-auth.json", "utf8"));
  const cached = await readFile(sessionPath, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (cached) {
    await page.context().addCookies(cached.cookies);
    const response = await page.request.get("/api/auth/me");
    if (
      response.ok() &&
      (await response.json()).user.username === auth.username
    ) {
      await page.goto("/projects");
      await expect(
        page.getByRole("heading", { name: "我的项目", exact: true }),
      ).toBeVisible();
      return;
    }
  }
  await page.goto("/login");
  await page.getByLabel("账号", { exact: true }).fill(auth.username);
  await page.getByLabel("密码", { exact: true }).fill(auth.password);
  const accepted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  expect((await accepted).status(), "synthetic administrator login").toBe(200);
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await writeFile(
    sessionPath,
    JSON.stringify({ cookies: await page.context().cookies() }),
    { mode: 0o600 },
  );
}
