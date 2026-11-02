import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
test("administrator sees platform and per-user token totals with incomplete reference pricing", async ({
  page,
  playwright,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const administrator = await (await page.request.get("/api/auth/me")).json();
  const origin = "http://127.0.0.1:5180";
  const issued = await (
    await page.request.post("/api/admin/users", {
      headers: { Origin: origin, "X-CSRF-Token": administrator.csrfToken },
      data: { username: `tokens-${randomUUID().slice(0, 8)}` },
    })
  ).json();
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
  const password = `Tokens-${randomUUID()}`;
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
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const name = `Token统计-${randomUUID().slice(0, 6)}`;
  try {
    const project = await (
      await member.post("/api/projects", { headers, data: { name } })
    ).json();
    const usage = await (await member.get("/api/images/usage")).json();
    const choice = usage.modelOptions?.[0];
    const response = await member.post("/api/images/tasks", {
      headers,
      data: {
        projectId: project.id,
        requestKey: randomUUID(),
        prompt: "Synthetic token evidence",
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
    expect(response.ok()).toBe(true);
    const task = await response.json();
    await expect
      .poll(
        async () =>
          (await (await member.get(`/api/images/tasks/${task.id}`)).json())
            .state,
      )
      .toBe("succeeded");
  } finally {
    await member.dispose();
  }
  const report = await (
    await page.request.get("/api/admin/model-usage?period=all")
  ).json();
  expect(report.allTime.calls).toBeGreaterThanOrEqual(1);
  await page.getByRole("link", { name: "用量与费用", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "用量与费用", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "全平台", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "按用户", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "项目", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "模型", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: session.user.username, exact: true }),
  ).toBeVisible();
  expect(report.allTime.calls).toBeGreaterThanOrEqual(1);
  expect(
    report.users.find((u: { id: string }) => u.id === session.user.id),
  ).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 256 });
  await expect(
    page.getByRole("cell", { name: "100", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "256", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "今日", exact: true }).click();
  await page.getByRole("tab", { name: "自统计以来", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: session.user.username, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".codex-temp/token-usage-1440.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: ".codex-temp/token-usage-1920.png" });
  await page.route("**/api/admin/model-usage?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const row of [body.today, body.thisMonth, body.allTime, ...body.users])
      row.unknownCachedUsage = row.calls;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.getByText(/次缓存用量缺失/)).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "—", exact: true }).first(),
  ).toBeVisible();
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5180",
  });
  expect((await anonymous.get("/api/admin/model-usage")).status()).toBe(401);
  await anonymous.dispose();
});
