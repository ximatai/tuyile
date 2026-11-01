import { test, expect } from "@playwright/test";
import { loginAdmin } from "./admin-session";
test("feature sessions reuse valid cookies and renew them after ordinary logout", async ({
  browser,
}) => {
  let logins = 0;
  for (let i = 0; i < 12; i++) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5180",
    });
    context.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/auth/login")
      )
        logins++;
    });
    try {
      const page = await context.newPage();
      await loginAdmin(page);
      expect((await page.request.get("/api/auth/me")).ok()).toBe(true);
      if (i === 11) {
        expect(logins).toBeLessThanOrEqual(1);
        await page
          .getByRole("button", { name: "账户菜单", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "退出登录", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "登录图一乐", exact: true }),
        ).toBeVisible();
        expect((await page.request.get("/api/auth/me")).status()).toBe(401);
        await loginAdmin(page);
        expect((await page.request.get("/api/auth/me")).ok()).toBe(true);
        expect(logins).toBeLessThanOrEqual(2);
      }
    } finally {
      await context.close();
    }
  }
});
