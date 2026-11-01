import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type {
  ImageUsage,
  ImageTask,
  SessionView,
  ProjectDemo,
  TemporaryPasswordResult,
} from "@tuyile/contracts";
import { emptyProjectDraft } from "@tuyile/contracts";
import { initialSettings } from "../apps/web/src/image-settings";
export async function verifyDemoOnboarding(
  page: Page,
  base: string,
  tag: string,
  onTemplate?: (id: string) => void,
) {
  page.setDefaultTimeout(15000);
  const me = (await (
    await page.request.get(base + "/api/auth/me")
  ).json()) as SessionView;
  const headers = { Origin: base, "X-CSRF-Token": me.csrfToken };
  async function get(path: string) {
    const r = await page.request.get(base + "/api" + path);
    expect(r.ok()).toBe(true);
    return r.json();
  }
  async function post(path: string, data: unknown) {
    const r = await page.request.post(base + "/api" + path, { headers, data });
    expect(r.ok()).toBe(true);
    return r.json();
  }
  const usage: ImageUsage = await get("/images/usage");
  const settings = initialSettings(usage),
    choice = usage.modelOptions?.find((m) => m.id === settings.modelKey);
  if (choice) {
    const catalog = await get("/model-admin/catalog");
    expect(
      catalog.services.find((s: any) => s.id === choice.serviceId)?.mode,
    ).toBe("fake");
  } else expect(usage.providerMode).toBe("fake");
  const source = await post("/projects", { name: `示例 · 合成入门 ${tag}` });
  const tasks: ImageTask[] = [];
  for (const name of ["A · 品牌标志", "B · 拿铁产品", "C · 合成海报"]) {
    const accepted = await post("/images/tasks", {
      projectId: source.id,
      requestKey: randomUUID(),
      prompt: `Synthetic demo ${name}`,
      model: choice?.modelId ?? settings.modelKey,
      ...(choice ? { modelSelectionId: choice.id } : {}),
      width: settings.width,
      height: settings.height,
      quality: settings.quality,
      format: settings.format,
      count: 1,
      referenceIds: tasks.length === 2 ? tasks.map((t) => t.outputs[0].id) : [],
    });
    await expect
      .poll(async () => (await get("/images/tasks/" + accepted.id)).state, {
        timeout: 30000,
      })
      .toBe("succeeded");
    tasks.push(await get("/images/tasks/" + accepted.id));
  }
  const assets = tasks.map((t) => t.outputs[0]);
  await post(`/projects/${source.id}/canvas`, {
    revision: 0,
    requestKey: randomUUID(),
    placements: assets.map((a) => a.outputId),
    document: {
      schemaVersion: 1,
      viewport: { x: 20, y: 60, zoom: 0.95 },
      nodes: assets.map((a, i) => ({
        id: randomUUID(),
        kind: "image",
        assetId: a.id,
        label: ["A · 品牌标志", "B · 拿铁产品", "C · 合成海报"][i],
        x: i === 2 ? 400 : 40,
        y: i === 1 ? 340 : 40,
        width: i === 2 ? 350 : 220,
        height: i === 2 ? 350 : 220,
      })),
    },
  });
  const draft = emptyProjectDraft();
  draft.direct.prompt = "参考 A 与 B，设计一张春季新品海报。";
  draft.agent.prompt = "先规划两张宣传图，确认后执行。";
  draft.referenceIds = assets.slice(0, 2).map((a) => a.id);
  await post(`/projects/${source.id}/draft`, {
    revision: 0,
    requestKey: randomUUID(),
    document: draft,
  });
  // The approved source must remain searchable beyond the first project page.
  for (let i = 0; i < 51; i++)
    await post("/projects", { name: `Later synthetic project ${tag} ${i}` });
  await page.goto(base + "/admin/users");
  await page.getByRole("button", { name: "新用户示例", exact: true }).click();
  const templateModal = page.getByRole("dialog", {
    name: "新用户示例",
    exact: true,
  });
  const projectPicker = templateModal.getByRole("combobox", {
    name: "示例来源项目",
    exact: true,
  });
  await projectPicker.fill(source.name);
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: source.name })
    .click();
  await templateModal
    .getByRole("button", { name: "发布示例模板", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(templateModal).toContainText("当前模板：" + source.name);
  const template = await get("/admin/demo-template");
  expect(template.name).toBe(source.name);
  onTemplate?.(template.id);
  await templateModal
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const username = `demo_${tag.replace(/[^a-z0-9]/g, "").slice(0, 18)}_${randomUUID().slice(0, 5)}`;
  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新增用户", exact: true });
  await create.getByLabel("用户名", { exact: true }).fill(username);
  const createdResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/admin/users",
  );
  await create.getByRole("button", { name: "新增用户", exact: true }).click();
  const issued = (await (
    await createdResponse
  ).json()) as TemporaryPasswordResult;
  expect(issued.demo?.state).toBe("ready");
  const password = await page
    .getByLabel("临时密码", { exact: true })
    .inputValue();
  expect(password).toBe(issued.temporaryPassword);
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  const browser = page.context().browser()!;
  const member = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const user = await member.newPage();
    user.setDefaultTimeout(15000);
    await user.goto(base + "/login");
    await user.getByLabel("账号", { exact: true }).fill(username);
    await user.getByLabel("密码", { exact: true }).fill(password);
    await user.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      user.getByRole("heading", { name: "设置自己的密码", exact: true }),
    ).toBeVisible();
    expect((await user.request.get(base + "/api/projects")).status()).toBe(403);
    const permanent = "Synthetic!" + randomUUID();
    await user.getByLabel("临时密码", { exact: true }).fill(password);
    await user.getByLabel("新密码", { exact: true }).fill(permanent);
    await user.getByLabel("确认新密码", { exact: true }).fill(permanent);
    await user
      .getByRole("button", { name: "保存并重新登录", exact: true })
      .click();
    await expect(user).toHaveURL(base + "/login");
    await user.getByLabel("账号", { exact: true }).fill(username);
    await user.getByLabel("密码", { exact: true }).fill(permanent);
    await user.getByRole("button", { name: "登录", exact: true }).click();
    await expect(user).toHaveURL(
      new RegExp(`/projects/${issued.demo!.projectId}$`),
    );
    await expect(user.locator(".workspace-title h1")).toHaveText(source.name);
    await expect(user.locator(".react-flow__node-image")).toHaveCount(3);
    await expect(user.locator(".react-flow__edge")).toHaveCount(2);
    const ownId = issued.demo!.projectId!;
    const examples = (await (
      await user.request.get(`${base}/api/projects/${ownId}/demo`)
    ).json()) as ProjectDemo;
    expect(examples.images).toHaveLength(3);
    expect(JSON.stringify(examples)).not.toContain("fileKey");
    expect(JSON.stringify(examples)).not.toContain("secret");
    expect(
      examples.images.some((i) => assets.some((a) => a.id === i.assetId)),
    ).toBe(false);
    const userSession = (await (
      await user.request.get(base + "/api/auth/me")
    ).json()) as SessionView;
    const memberHeaders = {
      Origin: base,
      "X-CSRF-Token": userSession.csrfToken,
    };
    const ownedUsage = await (
      await user.request.get(base + "/api/images/usage")
    ).json();
    expect(ownedUsage.used).toBe(0);
    expect(ownedUsage.attempts).toBe(0);
    expect(ownedUsage.storageUsed).toBeGreaterThan(0);
    expect(
      (
        await (
          await user.request.get(`${base}/api/images/tasks?projectId=${ownId}`)
        ).json()
      ).tasks,
    ).toHaveLength(0);
    await user.locator(".react-flow__node-image").first().hover();
    await user
      .locator(".canvas-image-actions.is-visible")
      .getByRole("button", { name: "查看示例提示词", exact: true })
      .click();
    const info = user.getByRole("dialog");
    await expect(info).toContainText("非本账号执行的生成任务");
    await expect(info.locator(".task-detail-prompt")).toHaveText(
      tasks[0].prompt,
    );
    await info.getByRole("button", { name: "关闭", exact: true }).click();
    await user
      .getByRole("button", { name: "任务与结果 · 0 · 示例 3", exact: true })
      .click();
    await expect(
      user.getByRole("region", { name: "示例创作记录", exact: true }),
    ).toBeVisible();
    await expect(user.locator(".demo-record-grid article")).toHaveCount(3);
    await expect(user.locator(".task-tile")).toHaveCount(0);
    await user
      .getByRole("button", { name: "任务与结果 · 0 · 示例 3", exact: true })
      .click();
    for (const width of [1440, 1920]) {
      await user.setViewportSize({
        width,
        height: width === 1440 ? 900 : 1080,
      });
      await user.screenshot({
        path: `.codex-temp/demo-${tag}-${width}.png`,
        animations: "disabled",
      });
    }
    for (const name of ["用户管理", "模型服务"])
      await expect(user.getByRole("link", { name, exact: true })).toHaveCount(
        0,
      );
    const menus = [
      ["项目", "/projects", "我的项目"],
      ["图库", "/gallery", "图库"],
      ["提示池", "/prompts", "提示池"],
      ["收藏", "/favorites", "收藏"],
      ["额度", "/usage", "额度"],
    ];
    for (const [name, path, heading] of menus) {
      await user.getByRole("link", { name, exact: true }).click();
      await expect(user).toHaveURL(base + path);
      await expect(user.locator("main.content h1")).toContainText(heading);
      if (path === "/gallery")
        await expect(user.getByText(/示例素材/)).toHaveCount(3);
      if (path === "/prompts")
        await expect(
          user.getByRole("link", { name: "管理创作预设", exact: true }),
        ).toHaveCount(0);
    }
    for (const path of ["/admin/users", "/admin/images", "/admin/prompts"]) {
      await user.goto(base + path);
      await expect(
        user.getByText("你没有执行此操作的权限。", { exact: true }),
      ).toBeVisible();
    }
    const forbidden = [
      "/admin/users",
      "/admin/prompts",
      "/admin/styles",
      "/admin/demo-template",
      "/model-admin/catalog",
      "/image-admin/providers",
      "/image-admin/planning-providers",
      "/image-admin/skills",
      "/image-admin/review",
      "/image-admin/summary",
      "/image-admin/execution-settings",
    ];
    for (const path of forbidden)
      expect(
        (await user.request.get(base + "/api" + path)).status(),
        path,
      ).toBe(403);
    expect(
      (
        await user.request.post(base + "/api/admin/users", {
          headers: memberHeaders,
          data: { username: "forbidden_" + randomUUID().slice(0, 6) },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await user.request.post(base + "/api/admin/demo-template", {
          headers: memberHeaders,
          data: { projectId: ownId, requestKey: randomUUID() },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await user.request.post(base + "/api/model-admin/bootstrap", {
          headers: memberHeaders,
          data: {},
        })
      ).status(),
    ).toBe(403);
    for (const path of [
      `/projects/${source.id}`,
      `/projects/${source.id}/canvas`,
      `/projects/${source.id}/draft`,
      `/projects/${source.id}/demo`,
      `/images/assets/${assets[0].id}/original`,
      `/images/tasks/${tasks[0].id}`,
    ])
      expect(
        (await user.request.get(base + "/api" + path)).status(),
        path,
      ).toBe(404);
    expect(
      (await page.request.get(`${base}/api/projects/${ownId}/demo`)).status(),
    ).toBe(404);
    expect(
      (
        await page.request.get(
          `${base}/api/images/assets/${examples.images[0].assetId}/original`,
        )
      ).status(),
    ).toBe(404);
    await user.goto(base + "/projects");
    await user
      .locator(".project-card-shell")
      .filter({ hasText: source.name })
      .getByRole("button", { name: `删除项目 ${source.name}`, exact: true })
      .click();
    await user
      .getByRole("dialog", { name: "请确认", exact: true })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(user.locator(".project-card")).toHaveCount(0);
    const deleted = await user.request.post(base + "/api/onboarding/demo", {
      headers: memberHeaders,
      data: {},
    });
    expect((await deleted.json()).state).toBe("removed");
    expect(
      (await (await user.request.get(base + "/api/projects")).json()).projects,
    ).toHaveLength(0);
    return {
      templateId: template.id,
      userId: issued.user.id,
      projectId: ownId,
      permissionChecks: forbidden.length + 9,
    };
  } finally {
    await member.close();
  }
}
