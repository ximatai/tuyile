import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
import { ensureTestPlanner } from "../planner-fixture";
import { initialSettings } from "../../apps/web/src/image-settings";

test("choose a main visual then derive a dependent work without regenerating the main visual", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const conversationModelId = await ensureTestPlanner(
    page,
    "selection-planner",
  );
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: `Selection-${randomUUID().slice(0, 6)}` },
    })
  ).json();
  const usage = await (await page.request.get("/api/images/usage")).json();
  const settings = initialSettings(usage);
  const choice = usage.modelOptions?.find(
    (m: any) => m.id === settings.modelKey,
  );
  const spec = {
    model: choice?.modelId ?? settings.modelKey,
    ...(choice ? { modelSelectionId: choice.id } : {}),
    width: settings.width,
    height: settings.height,
    quality: settings.quality,
    format: settings.format,
    referenceIds: [],
  };
  const job = await (
    await page.request.post("/api/agent/planning", {
      headers,
      data: {
        ...spec,
        projectId: project.id,
        requestKey: randomUUID(),
        prompt: "Synthetic main visual",
        preserveRequirements: "保持商品外观",
        ...(conversationModelId ? { conversationModelId } : {}),
      },
    })
  ).json();
  let original: any;
  await expect
    .poll(async () => {
      const jobs = await (
        await page.request.get(`/api/agent/jobs?projectId=${project.id}`)
      ).json();
      original = jobs.jobs.find((j: any) => j.id === job.id)?.plans.at(-1);
      return !!original;
    })
    .toBe(true);
  const a = {
    ...spec,
    title: "主视觉 A",
    prompt: "Synthetic A",
    count: 1,
    tool: { id: "image.generate", version: 1 },
    usePrevious: false,
  };
  const saved = await (
    await page.request.post(`/api/agent/jobs/${job.id}/revisions`, {
      headers,
      data: {
        requestKey: randomUUID(),
        document: {
          message: "先选定主视觉，再衍生",
          steps: [
            a,
            {
              ...a,
              title: "衍生 B",
              usePrevious: true,
              tool: { id: "image.edit", version: 1 },
            },
          ],
        },
      },
    })
  ).json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
  await page.getByText("选择步骤／复用作品继续", { exact: true }).click();
  await page.getByRole("checkbox", { name: "主视觉 A", exact: true }).check();
  let loseSelection = true;
  await page.route(
    `**/api/agent/plans/${saved.id}/selection`,
    async (route) => {
      if (loseSelection) {
        loseSelection = false;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "保存所选方案", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试保存所选方案", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "清空规划对话", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("方案版本", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "重试保存所选方案", exact: true })
    .click();

  await expect(
    page.getByText("本计划预留 1 张图片", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect
    .poll(async () => {
      const { tasks } = await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json();
      return tasks.filter((t: any) => t.state === "succeeded").length;
    })
    .toBe(1);
  await page.route("**/api/images/tasks?projectId=*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, tasks: [] } });
  });
  await page.reload();
  await page.getByLabel("方案版本", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
    .filter({ hasText: `版本 ${saved.version} · 待确认` })
    .click();
  await page.getByText("选择步骤／复用作品继续", { exact: true }).click();
  await page.getByRole("checkbox", { name: "衍生 B", exact: true }).check();
  const binding = page.getByLabel("复用 主视觉 A 的作品", { exact: true });
  await binding.click();
  await binding.press("ArrowDown");
  await binding.press("Enter");
  await expect(
    page.getByAltText("选定的前置作品", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存所选方案", exact: true }).click();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await page.unroute("**/api/images/tasks?projectId=*");
  await expect
    .poll(async () => {
      const { tasks } = await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json();
      return (
        tasks.length === 2 && tasks.every((t: any) => t.state === "succeeded")
      );
    })
    .toBe(true);
});
