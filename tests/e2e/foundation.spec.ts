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
  await expect(page.getByLabel("项目名称")).toHaveValue("");
  await page
    .locator(".project-card")
    .filter({ hasText: "品牌视觉方案" })
    .click();
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
  await expect(page.getByLabel("新账号")).toHaveValue("");
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
  ).toBeVisible({ timeout: 15000 });
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
  await page
    .getByRole("row")
    .filter({ hasText: "hashuser02" })
    .getByRole("button", { name: "重新生成链接" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
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

test("background creation survives refresh, page closure and ordinary logout, with private results on mobile", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByLabel("项目名称").fill("后台创作验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "后台创作验证" })
    .click();
  await expect(page.getByText("本地测试模型：生成测试色块")).toBeVisible();
  const projectUrl = page.url();
  await page.getByLabel("创作需求").fill("合成测试：关闭页面后继续执行");
  await page.getByLabel("图片张数").fill("2");
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  await expect(page.getByText("合成测试：关闭页面后继续执行")).toBeVisible();
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 1440, height: 900 });
  await reopened.goto(projectUrl);
  await expect(
    reopened.getByRole("heading", { name: "已完成", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    reopened
      .locator(".canvas-task-history")
      .getByRole("link", { name: "下载原图" }),
  ).toHaveCount(2);
  await reopened.getByLabel("创作需求").fill("合成测试：注销后继续");
  await reopened.getByLabel("图片张数").fill("2");
  await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .click();
  await expect(reopened.getByText("合成测试：注销后继续")).toBeVisible();
  await reopened.reload();
  await reopened.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    reopened.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await login(reopened);
  await reopened.goto(projectUrl);
  await expect(
    reopened.getByRole("heading", { name: "已完成", exact: true }),
  ).toHaveCount(2, { timeout: 15000 });
  const png = (await import("sharp")).default;
  const bytes = await png({
    create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
  })
    .png()
    .toBuffer();
  await reopened
    .getByTestId("reference-upload")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await expect(reopened.getByText("synthetic.png")).toBeVisible();
  await reopened.getByLabel("创作需求").fill("合成测试：参考图");
  await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .click();
  await expect(
    reopened.getByRole("heading", { name: "已完成", exact: true }),
  ).toHaveCount(3, { timeout: 15000 });
  await reopened.screenshot({
    path: ".codex-temp/stage2-desktop-workbench.png",
    fullPage: true,
  });
  const submitBox = await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .boundingBox();
  const quotaBox = await reopened
    .locator(".quota-details summary")
    .boundingBox();
  expect(submitBox).not.toBeNull();
  expect(quotaBox).not.toBeNull();
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(quotaBox!.y);
  await reopened.setViewportSize({ width: 1920, height: 1080 });
  await expect(reopened.locator(".react-flow__node-image")).toHaveCount(5);
  await expect(
    reopened
      .locator(".canvas-task-history")
      .getByRole("link", { name: "下载原图" }),
  ).toHaveCount(5);
  expect(
    await reopened.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reopened.screenshot({
    path: ".codex-temp/m3-step3-wide-results.png",
    fullPage: true,
  });
  await reopened.getByRole("link", { name: "额度与任务", exact: true }).click();
  await expect(
    reopened.getByRole("heading", { name: "我的额度与任务" }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", { name: "上传的参考图" }),
  ).toBeVisible();
  await reopened.getByRole("link", { name: "图片服务", exact: true }).click();
  await expect(
    reopened.getByRole("heading", { name: "创作服务与额度" }),
  ).toBeVisible();
  expect(
    await reopened.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reopened.screenshot({
    path: ".codex-temp/m3-step3-wide-admin.png",
    fullPage: true,
  });
});

test("desktop administration saves independent planning configuration and versioned skills", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto("/admin/images");
  await page.getByLabel("规划服务类型", { exact: true }).click();
  await page
    .getByText("本地测试规划（不调用真实模型）", { exact: true })
    .click();
  await page.getByLabel("规划模型 ID").fill("test-planner");
  await page.getByRole("button", { name: "保存规划服务", exact: true }).click();
  await expect(page.getByText("test-planner", { exact: true })).toBeVisible();
  await page.getByLabel("技能标识").fill("synthetic-photo");
  await page.getByLabel("技能名称").fill("合成商品图");
  await page.getByLabel("技能说明").fill("只用于合成验收");
  await page
    .getByLabel("创作指导", { exact: true })
    .fill("先确定构图，再生成一张图片。不得绕过确认或额度。");
  await page.getByRole("button", { name: "保存并启用新技能版本" }).click();
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByText("合成商品图 v1", { exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "普通停用", exact: true }).click();
  await expect(row.getByText("已停用", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await expect(row.getByText("可用于新计划", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "派生新版本" }).click();
  await expect(page.getByLabel("技能版本", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "保存并启用新技能版本" }).click();
  await expect(page.getByText("合成商品图 v2", { exact: true })).toBeVisible();
  await expect(row.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByLabel("允许的模型（英文逗号分隔）").fill("test-image");
  await page.getByText("test-image 的能力声明", { exact: true }).click();
  await expect(page.getByLabel("模型最大边长", { exact: true })).toBeVisible();
  await page.getByLabel("模型最大边长", { exact: true }).fill("2048");
  const sizes = page.getByLabel(/^限定尺寸/);
  await sizes.pressSequentially("1024x1024,512x512");
  await expect(sizes).toHaveValue("1024x1024,512x512");
  await page.getByLabel("服务类型", { exact: true }).click();
  await page
    .getByText("本地测试服务（不调用真实模型）", { exact: true })
    .click();
  await page.getByRole("button", { name: "保存图片服务", exact: true }).click();
  await expect(page.getByText("已保存。", { exact: true })).toBeVisible();
  const providerResponse = await page.request.get("/api/image-admin/providers");
  expect(providerResponse.ok()).toBe(true);
  const { providers } = await providerResponse.json();
  expect(providers[0].capabilities[0].sizes).toEqual(["1024x1024", "512x512"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".codex-temp/m3-step2-admin-1440.png",
    fullPage: true,
  });
});

test("desktop canvas saves geometry, handles conflicts and never replaces removed outputs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("画布保存验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "画布保存验证" })
    .click();
  await page.getByLabel("创作需求").fill("合成画布图片");
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  const node = page.locator(".react-flow__node-image").first();
  await expect(node).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const projectUrl = page.url(),
    projectId = projectUrl.split("/").at(-1)!;
  const first = await (
    await page.request.get(`/api/projects/${projectId}/canvas`)
  ).json();
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 70, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 130, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const saved = await (
        await page.request.get(`/api/projects/${projectId}/canvas`)
      ).json();
      return saved.document.nodes[0].x;
    })
    .not.toBe(first.document.nodes[0].x);
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "移除节点", exact: true }).click();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  await page.reload();
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
  const session = await (await page.request.get("/api/auth/me")).json();
  const remote = await (
    await page.request.get(`/api/projects/${projectId}/canvas`)
  ).json();
  const response = await page.request.post(
    `/api/projects/${projectId}/canvas`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": session.csrfToken,
      },
      data: {
        ...remote,
        requestKey: crypto.randomUUID(),
        placements: [],
        document: { ...remote.document, viewport: { x: 90, y: 0, zoom: 1 } },
      },
    },
  );
  expect(response.ok()).toBe(true);
  await page.locator(".react-flow__controls-zoomin").click();
  await expect(page.getByText(/画布已在其他页面修改/)).toBeVisible();
  await page.getByRole("link", { name: "查看全部任务与额度" }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByText(/未能保存画布/)).toBeVisible();
  let rejectedRequest:
    | { requestKey: string; document: { viewport: { zoom: number } } }
    | undefined;
  await page.route(
    `**/api/projects/${projectId}/canvas/copy`,
    async (route) => {
      rejectedRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "REFERENCE_UNAVAILABLE" } }),
      });
    },
  );
  await page.getByRole("button", { name: "另存副本", exact: true }).click();
  await expect(page.getByText("参考图已不可用，请重新选择。")).toBeVisible();
  await page.locator(".react-flow__controls-zoomout").click();
  await page.waitForTimeout(500);
  await page.unroute(`**/api/projects/${projectId}/canvas/copy`);
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>((r) => (release = r)),
    requested = new Promise<void>((r) => (started = r));
  let copiedId = "";
  await page.route(
    `**/api/projects/${projectId}/canvas/copy`,
    async (route) => {
      const nextRequest = route.request().postDataJSON();
      expect(nextRequest.requestKey).not.toBe(rejectedRequest!.requestKey);
      expect(nextRequest.document.viewport.zoom).not.toBe(
        rejectedRequest!.document.viewport.zoom,
      );
      const response = await route.fetch();
      copiedId = (await response.json()).id;
      started();
      await blocked;
      await route.fulfill({ response });
    },
  );
  await page.getByRole("button", { name: "另存副本", exact: true }).click();
  await requested;
  await page.locator(".react-flow__controls-zoomout").click();
  await expect(page.locator(".react-flow__viewport")).toHaveCSS(
    "transform",
    /matrix/,
  );
  // React Flow animates viewport changes; wait for its final onMoveEnd before acknowledging the copy.
  await page.waitForTimeout(500);
  release();
  await expect(page.getByText(/等待期间的新修改仍保留/)).toBeVisible();
  await expect(page).toHaveURL(projectUrl);
  const earlierCopy = await (
    await page.request.get(`/api/projects/${copiedId}/canvas`)
  ).json();
  await page.unroute(`**/api/projects/${projectId}/canvas/copy`);
  await page.getByRole("button", { name: "另存副本", exact: true }).click();
  await expect(page).not.toHaveURL(projectUrl);
  await expect(
    page.getByRole("heading", { name: "画布保存验证（副本）" }),
  ).toBeVisible();
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const finalCopy = await (
    await page.request.get(
      `/api/projects/${page.url().split("/").at(-1)}/canvas`,
    )
  ).json();
  expect(finalCopy.document.viewport.zoom).not.toBe(
    earlierCopy.document.viewport.zoom,
  );
  await expect(page.getByText(/未能保存画布/)).toHaveCount(0);
  async function checkWorkspaceBounds() {
    const panel = (await page.locator(".creation-panel").boundingBox())!;
    const canvas = (await page.locator(".canvas-surface").boundingBox())!;
    const navigation = (await page.locator(".sidebar").boundingBox())!;
    const submit = (await page
      .getByRole("button", { name: "提交图片任务", exact: true })
      .boundingBox())!;
    const quota = (await page.locator(".quota-details summary").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(
      Math.abs(canvas.x - (navigation.x + navigation.width)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(panel.x + panel.width - viewport.width),
    ).toBeLessThanOrEqual(2);
    expect(submit.y + submit.height).toBeLessThanOrEqual(viewport.height);
    expect(quota.y + quota.height).toBeLessThanOrEqual(viewport.height);
  }
  await checkWorkspaceBounds();
  await page.screenshot({ path: ".codex-temp/m3-step3-canvas-1440.png" });
  await page.getByRole("button", { name: "收起导航" }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await checkWorkspaceBounds();
  await page.screenshot({ path: ".codex-temp/m3-step3-canvas-1920.png" });
});

test("Agent plans remain unexecuted until confirmation and edited sequential plans survive refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/admin/images");
  await page.getByLabel("规划服务类型", { exact: true }).click();
  await page
    .getByText("本地测试规划（不调用真实模型）", { exact: true })
    .click();
  await page.getByLabel("规划模型 ID").fill("synthetic-planner-e2e");
  await page.getByRole("button", { name: "保存规划服务", exact: true }).click();
  await expect(
    page.getByText("synthetic-planner-e2e", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("Agent 顺序创作");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "Agent 顺序创作" })
    .click();
  const projectId = page.url().split("/").at(-1)!;
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page
    .getByText("创作设置 · 通用创作 · test-image", { exact: true })
    .click();
  const referenceBytes = await (
    await import("sharp")
  )
    .default({
      create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  await page.locator(".agent-references input[type=file]").setInputFiles({
    name: "agent-product.png",
    mimeType: "image/png",
    buffer: referenceBytes,
  });
  await expect(
    page
      .locator(".agent-references")
      .getByRole("img", { name: "agent-product.png" }),
  ).toBeVisible();
  await page
    .getByLabel("告诉 Agent 你的想法", { exact: true })
    .fill("合成验收：先生成基准图，再参考基准图改图");
  await page.getByRole("button", { name: "发送规划需求", exact: true }).click();
  await expect(page.getByLabel("计划步骤摘要")).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("步骤 1 提示词", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "修改计划", exact: true }).click();
  await expect(page.getByLabel("步骤 1 提示词", { exact: true })).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toEqual([]);
  const planningBefore = await (
    await page.request.get("/api/agent/usage")
  ).json();
  await page.getByLabel("步骤 1 张数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "添加步骤", exact: true }).click();
  await page.getByLabel("步骤 2 张数", { exact: true }).fill("1");
  await page.getByLabel("使用上一步第一张图片").check();
  await expect(
    page.getByText("本计划预留 3 张图片", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存计划修改", exact: true }).click();
  await expect(page.getByText("创作计划 · v2", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(page.getByLabel("计划步骤摘要")).toBeVisible();
  await page.getByRole("button", { name: "修改计划", exact: true }).click();
  await expect(page.getByLabel("步骤 1 张数", { exact: true })).toHaveValue(
    "2",
  );
  await expect(page.getByLabel("使用上一步第一张图片")).toBeChecked();
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toEqual([]);
  await page.getByRole("button", { name: "查看计划摘要", exact: true }).click();
  await expect(page.getByLabel("计划步骤摘要").locator("li")).toHaveCount(2);
  const confirm = (await page
    .getByRole("button", { name: "确认执行", exact: true })
    .boundingBox())!;
  expect(confirm.y + confirm.height).toBeLessThanOrEqual(900);
  await page.screenshot({
    animations: "disabled",
    path: ".codex-temp/m3-agent-plan-1440.png",
  });
  let lostConfirmation = false;
  await page.route("**/api/agent/plans/*/confirm", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    lostConfirmation = true;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(
    page.getByText("计划正在后台执行", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3, {
    timeout: 30000,
  });
  await expect
    .poll(
      async () => {
        const data = await (
          await page.request.get(`/api/images/tasks?projectId=${projectId}`)
        ).json();
        return data.tasks.filter(
          (t: { state: string }) => t.state === "succeeded",
        ).length;
      },
      { timeout: 30000 },
    )
    .toBe(2);
  expect(lostConfirmation).toBe(true);
  await expect(
    page.locator(".agent-plan-title").getByText("已确认", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("正在确认这份版本；结果不明时再次点击确认可找回原提交。", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".agent-plan-form").getByRole("alert")).toHaveCount(
    0,
  );
  const planningAfter = await (
    await page.request.get("/api/agent/usage")
  ).json();
  expect(planningAfter.used).toBe(planningBefore.used);
  await page.reload();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(page.getByText("计划已确认", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    animations: "disabled",
    path: ".codex-temp/m3-agent-result-1920.png",
  });
});

test("Gallery reuse, ZIP export, favorites, prompt application and project cleanup preserve originals and usage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("素材复用目标");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  const targetHref = await page
    .locator(".project-card")
    .filter({ hasText: "素材复用目标" })
    .getAttribute("href");
  const before = await (await page.request.get("/api/images/usage")).json();
  await page.getByRole("link", { name: "图库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的图库", exact: true }),
  ).toBeVisible();
  const card = page.locator(".gallery-card").first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "收藏图片", exact: true }).click();
  await page.getByLabel("收藏标题", { exact: true }).fill("素材测试收藏");
  await page.getByLabel("收藏分组名称", { exact: true }).fill("验收分组");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(page.getByText("收藏已保存。", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "删除原图", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByText(/图片仍被画布、任务、对话或收藏引用/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "收藏：素材测试收藏", exact: true }),
  ).toBeVisible();
  await card.getByRole("checkbox").check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出所选 ZIP", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("tuyile-images.zip");
  const { unzipSync } = await import("fflate");
  expect(
    Object.keys(
      unzipSync(new Uint8Array(await readFile((await download.path())!))),
    ),
  ).toHaveLength(1);
  await page.screenshot({
    path: ".codex-temp/m3-gallery-1440.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "加入目标画布", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${targetHref}$`));
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  expect(
    (await (await page.request.get("/api/images/usage")).json()).used,
  ).toBe(before.used);
  await page.getByRole("link", { name: "图库", exact: true }).click();
  await page.locator(".gallery-card").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "设为参考图", exact: true }).click();
  await expect(page.getByText("图库参考图", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "提示池", exact: true }),
  ).toBeVisible();
  const template = page.locator(".prompt-card").first();
  await template
    .getByRole("button", { name: "收藏提示词", exact: true })
    .click();
  await page.getByLabel("收藏标题", { exact: true }).fill("提示收藏验收");
  await page.getByLabel("收藏分组名称", { exact: true }).fill("写作");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(page.getByText("收藏已保存。", { exact: true })).toBeVisible();
  const prompt = (await (await page.request.get("/api/library/prompts")).json())
    .prompts[0].prompt;
  await template
    .getByRole("button", { name: "用于目标项目", exact: true })
    .click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    prompt,
  );
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的收藏", exact: true }),
  ).toBeVisible();
  const favorite = page.locator(".favorite-card").filter({
    has: page.getByRole("heading", { name: "素材测试收藏", exact: true }),
  });
  await favorite.getByRole("button", { name: "编辑收藏", exact: true }).click();
  await page.getByLabel("收藏标题", { exact: true }).fill("更新素材收藏");
  await page.getByLabel("收藏分组名称", { exact: true }).fill("归档");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "更新素材收藏", exact: true }),
  ).toBeVisible();
  await page.getByLabel("收藏分组", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("归档", { exact: true })
    .click();
  await expect(page.locator(".favorite-card")).toHaveCount(1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    path: ".codex-temp/m3-favorites-1920.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "移除收藏", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".favorite-card")).toHaveCount(0);
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page
    .getByRole("button", { name: "删除项目 素材复用目标", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.locator(".project-card").filter({ hasText: "素材复用目标" }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/images/usage")).json()).used,
  ).toBe(before.used);
  await page.getByRole("link", { name: "图库", exact: true }).click();
  await expect(page.locator(".gallery-card").first()).toBeVisible();
});

test("administration saves bounded execution policies and clearing ended Agent history preserves images and charges", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/admin/images");
  await expect(
    page.getByRole("heading", { name: "运行概览与规划策略", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("图片统计日、逐单预留和规划计次对账一致。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("全局规划并发", { exact: true }).fill("3");
  await page.getByLabel("全局规划排队上限", { exact: true }).fill("32");
  await page.getByRole("button", { name: "保存执行设置", exact: true }).click();
  await expect(
    page.getByText("执行设置已保存。", { exact: true }),
  ).toBeVisible();
  const settings = await (
    await page.request.get("/api/image-admin/execution-settings")
  ).json();
  expect(settings.planning).toEqual({ concurrency: 3, queueLimit: 32 });
  await page.getByLabel("规划策略账号", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText(auth.username, { exact: true })
    .click();
  await expect(page.getByLabel("每日规划次数", { exact: true })).toHaveValue(
    "50",
  );
  await page.getByLabel("每日规划次数", { exact: true }).fill("45");
  await page.getByLabel("每用户规划排队上限", { exact: true }).fill("8");
  await page.getByRole("button", { name: "保存规划策略", exact: true }).click();
  await expect(
    page.getByText("规划策略已保存。", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/agent/usage")).json()).dailyLimit,
  ).toBe(45);
  await page.locator(".operations-admin").screenshot({
    path: ".codex-temp/m3-administration-1440.png",
    animations: "disabled",
  });
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "Agent 顺序创作" })
    .click();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(page.getByText("计划已确认", { exact: true })).toBeVisible();
  const before = await (await page.request.get("/api/agent/usage")).json(),
    imagesBefore = await (await page.request.get("/api/images/usage")).json();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3);
  await page.getByRole("button", { name: "清空规划对话", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "先聊想法，再确认创作", exact: true }),
  ).toBeVisible();
  const after = await (await page.request.get("/api/agent/usage")).json();
  expect(after.used).toBe(before.used);
  expect(
    (await (await page.request.get("/api/images/usage")).json()).used,
  ).toBe(imagesBefore.used);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3);
});
