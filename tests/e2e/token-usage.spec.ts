import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
test("administrator sees platform and project token totals with incomplete reference pricing", async ({
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
  const name = `Token统计-${randomUUID().slice(0, 6)}`;
  const project = await (
    await page.request.post("/api/projects", { headers, data: { name } })
  ).json();
  const usage = await (await page.request.get("/api/images/usage")).json();
  const choice = usage.modelOptions?.[0];
  const response = await page.request.post("/api/images/tasks", {
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
        (await (await page.request.get(`/api/images/tasks/${task.id}`)).json())
          .state,
    )
    .toBe("succeeded");
  const report = await (
    await page.request.get(`/api/admin/model-usage?projectId=${project.id}`)
  ).json();
  expect(report.today).toMatchObject({
    calls: 1,
    inputTokens: 100,
    outputTokens: 256,
    unknownUsage: 0,
  });
  await page.getByRole("link", { name: "用量与费用", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "用量与费用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "全部项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "100", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "256", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "今日", exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: ".codex-temp/token-usage-1440.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: ".codex-temp/token-usage-1920.png" });
  await page.getByRole("button", { name: "全部项目", exact: true }).click();
  await page.route("**/api/admin/model-usage?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const row of [
      body.today,
      body.thisMonth,
      ...body.projects,
      ...body.models,
    ])
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
