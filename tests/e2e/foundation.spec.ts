import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
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
async function selectCreationPanel(page: Page, mode: "direct" | "agent") {
  const button = page.getByRole("button", {
    name: mode === "direct" ? "直接创作面板" : "Agent 面板",
    exact: true,
  });
  if ((await button.getAttribute("aria-pressed")) !== "true")
    await button.click();
}
async function logoutFromMenu(page: Page) {
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
}
test("desktop and mobile: persistent projects, initial password, account boundaries and password revocation", async ({
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
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  const createUserDialog = page.getByRole("dialog", {
    name: "新增用户",
    exact: true,
  });
  await createUserDialog
    .getByLabel("用户名", { exact: true })
    .fill("designer01");
  await createUserDialog
    .getByRole("button", { name: "新增用户", exact: true })
    .click();
  await expect(createUserDialog).toBeHidden();
  const initialTemporaryPassword = await page
    .getByLabel("临时密码", { exact: true })
    .inputValue();
  await page
    .getByRole("row")
    .filter({ hasText: "designer01" })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "designer01" });
  const quota = drawer.getByLabel("每日图片额度", { exact: true });
  await expect(quota).toBeVisible();
  await expect(quota).toHaveValue("100");
  const originalQuota = await quota.inputValue();
  const storage = drawer.getByLabel("存储上限（GB）", { exact: true });
  const originalStorage = await storage.inputValue();
  await expect(
    drawer.getByLabel("图片最大边长（px）", { exact: true }),
  ).toBeHidden();
  await drawer.getByText("高级设置", { exact: true }).click();
  await expect(
    drawer.getByLabel("图片最大边长（px）", { exact: true }),
  ).toBeVisible();
  await drawer.getByText("高级设置", { exact: true }).click();
  await storage.fill("1.5");

  await quota.fill("7");
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(quota).toHaveValue("7");
  await drawer
    .getByRole("button", { name: "保存用户配置", exact: true })
    .click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page
    .getByRole("row")
    .filter({ hasText: "designer01" })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await expect(quota).toHaveValue("7");
  await expect(storage).toHaveValue("1.5");
  await drawer.getByRole("checkbox", { name: "不限额", exact: true }).check();
  await expect(quota).toBeDisabled();
  await drawer
    .getByRole("button", { name: "保存用户配置", exact: true })
    .click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page
    .getByRole("row")
    .filter({ hasText: "designer01" })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await expect(
    drawer.getByRole("checkbox", { name: "不限额", exact: true }),
  ).toBeChecked();
  await expect(quota).toBeDisabled();
  await drawer.getByRole("checkbox", { name: "不限额", exact: true }).uncheck();

  await storage.fill(originalStorage);
  await quota.fill(originalQuota);
  await drawer
    .getByRole("button", { name: "保存用户配置", exact: true })
    .click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toBeHidden();

  await expect(
    page.getByRole("row").filter({ hasText: "designer01" }),
  ).toContainText("待修改密码");
  await page.screenshot({
    path: ".codex-temp/stage1-desktop-admin.png",
    fullPage: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const member = await context.newPage();
  const newPassword = randomBytes(24).toString("base64url");
  await member.goto("http://127.0.0.1:5180/login");
  await member.getByLabel("账号", { exact: true }).fill("designer01");
  await member
    .getByLabel("密码", { exact: true })
    .fill(initialTemporaryPassword);
  await member.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    member.getByRole("heading", { name: "设置自己的密码", exact: true }),
  ).toBeVisible();
  await member
    .getByLabel("临时密码", { exact: true })
    .fill(initialTemporaryPassword);
  await member.getByLabel("新密码", { exact: true }).fill(newPassword);
  await member.getByLabel("确认新密码", { exact: true }).fill(newPassword);
  await member
    .getByRole("button", { name: "保存并重新登录", exact: true })
    .click();
  await expect(
    member.getByRole("heading", { name: "登录图一乐", exact: true }),
  ).toBeVisible();
  await member.getByLabel("账号", { exact: true }).fill("designer01");
  await member.getByLabel("密码", { exact: true }).fill(newPassword);
  await member.getByRole("button", { name: "登录", exact: true }).click();
  await expect(member.getByRole("heading", { name: "我的项目" })).toBeVisible();
  await expect(
    member.getByRole("link", { name: "用户管理", exact: true }),
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
  await expect(
    member.getByRole("link", { name: "账户安全", exact: true }),
  ).toHaveCount(0);
  await member
    .getByRole("button", { name: "账户菜单", exact: true })
    .press("Enter");
  await expect(
    member.getByRole("menuitem", { name: "修改密码", exact: true }),
  ).toBeVisible();
  await member.keyboard.press("Escape");
  await expect(
    member.getByRole("menuitem", { name: "修改密码", exact: true }),
  ).toBeHidden();
  await member.getByRole("button", { name: "账户菜单", exact: true }).click();
  const passwordContextUrl = member.url();
  await member
    .getByRole("menuitem", { name: "修改密码", exact: true })
    .press("Enter");
  await expect(
    member.getByRole("dialog", { name: "修改密码", exact: true }),
  ).toBeVisible();
  await expect(member).toHaveURL(passwordContextUrl);
  await member.getByLabel("当前密码").fill("discarded-password-draft");
  await member
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(member.getByRole("dialog")).toBeHidden();
  await expect(
    member.getByRole("button", { name: "账户菜单", exact: true }),
  ).toBeFocused();
  await member.getByRole("button", { name: "账户菜单", exact: true }).click();
  await member.getByRole("menuitem", { name: "修改密码", exact: true }).click();
  await expect(member.getByLabel("当前密码")).toHaveValue("");
  await member.getByLabel("当前密码").fill(newPassword);
  const changed = randomBytes(24).toString("base64url");
  await member.getByLabel("新密码", { exact: true }).fill(changed);
  await member.getByLabel("确认新密码").fill("mismatched-confirmation");
  await member.getByRole("button", { name: "保存并重新登录" }).click();
  await expect(member.getByRole("dialog").getByRole("alert")).toContainText(
    "两次输入的密码不一致",
  );
  await expect(member).toHaveURL(passwordContextUrl);
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
  await logoutFromMenu(member);
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
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
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

test("administrator resets a password and user must replace the temporary password", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  const createUserDialog = page.getByRole("dialog", {
    name: "新增用户",
    exact: true,
  });
  await createUserDialog
    .getByLabel("用户名", { exact: true })
    .fill("hashuser02");
  await createUserDialog
    .getByRole("button", { name: "新增用户", exact: true })
    .click();
  await expect(createUserDialog).toBeHidden();
  const initialTemporaryPassword = await page
    .getByLabel("临时密码", { exact: true })
    .inputValue();
  const context = await browser.newContext();
  const member = await context.newPage();
  await member.goto("http://127.0.0.1:5180/login");
  await expect(
    member.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await member.getByLabel("账号", { exact: true }).fill("hashuser02");
  await member
    .getByLabel("密码", { exact: true })
    .fill(initialTemporaryPassword);
  await member.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    member.getByRole("heading", { name: "设置自己的密码", exact: true }),
  ).toBeVisible();
  const first = randomBytes(24).toString("base64url");
  await member
    .getByLabel("临时密码", { exact: true })
    .fill(initialTemporaryPassword);
  await member.getByLabel("新密码", { exact: true }).fill(first);
  await member.getByLabel("确认新密码", { exact: true }).fill(first);
  await member
    .getByRole("button", { name: "保存并重新登录", exact: true })
    .click();
  await expect(
    member.getByRole("heading", { name: "登录图一乐", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "hashuser02" })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  await page.getByRole("button", { name: "更多账号操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "重置密码", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  const temporaryPassword = await page
    .getByLabel("临时密码", { exact: true })
    .inputValue();
  await expect(
    page.getByRole("row").filter({ hasText: "hashuser02" }),
  ).toContainText("待修改密码");
  await member.goto("http://127.0.0.1:5180/login");
  await member.getByLabel("账号", { exact: true }).fill("hashuser02");
  await member.getByLabel("密码", { exact: true }).fill(temporaryPassword);
  await member.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    member.getByRole("heading", { name: "设置自己的密码", exact: true }),
  ).toBeVisible();
  await member.goto("http://127.0.0.1:5180/admin/users");
  await expect(
    member.getByRole("heading", { name: "设置自己的密码", exact: true }),
  ).toBeVisible();
  const second = randomBytes(24).toString("base64url");
  await member.getByLabel("临时密码", { exact: true }).fill(temporaryPassword);
  await member.getByLabel("新密码", { exact: true }).fill(second);
  await member.getByLabel("确认新密码", { exact: true }).fill(second);
  await member
    .getByRole("button", { name: "保存并重新登录", exact: true })
    .click();
  await expect(
    member.getByRole("heading", { name: "登录图一乐", exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "简洁商品展示", exact: true }).click();
  await expect(page.getByLabel("创作需求")).toHaveValue(/棚拍展示图/);
  const authoredPrompt = await page.getByLabel("创作需求").inputValue();
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("真实摄影", { exact: true })
    .click();
  await expect(page.getByLabel("创作需求")).toHaveValue(authoredPrompt);
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  const presetDescription = await page
    .getByLabel("风格描述", { exact: true })
    .inputValue();
  await page.getByLabel("风格描述", { exact: true }).fill("未应用的草稿");
  await page
    .locator(".style-editor")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(page.getByLabel("风格描述", { exact: true })).toHaveValue(
    presetDescription,
  );
  await page.getByLabel("风格描述", { exact: true }).fill("临时修改");
  await page.getByRole("button", { name: "恢复原风格", exact: true }).click();
  await expect(page.getByLabel("风格描述", { exact: true })).toHaveValue(
    presetDescription,
  );
  await page
    .getByLabel("风格描述", { exact: true })
    .fill("合成风格：柔和自然光");
  await expect(page.getByLabel("创作需求")).toHaveValue(authoredPrompt);
  await page
    .locator(".style-editor")
    .getByRole("button", { name: "应用", exact: true })
    .click();
  const styledDraft = await page.getByLabel("创作需求").inputValue();
  await page.getByRole("button", { name: "叙事插画场景", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByLabel("创作需求")).toHaveValue(styledDraft);
  const resolutionField = page.locator(".direct-creation .field").filter({
    has: page.getByRole("combobox", { name: "尺寸", exact: true }),
  });
  await expect(resolutionField.locator(".size-pixels")).toHaveCount(0);
  await page.getByRole("combobox", { name: "尺寸", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^2048 × 2048$/ })
    .click();
  await page.getByRole("combobox", { name: "比例", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^16:9$/ })
    .click();
  await expect(resolutionField).toContainText("2048 × 1152");
  await page.getByRole("combobox", { name: "尺寸", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^1824 × 1024$/ })
    .click();
  await expect(resolutionField).toContainText("1824 × 1024");
  await page.getByRole("combobox", { name: "尺寸", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("1280 × 720 · 720p", { exact: true })
    .click();
  await expect(resolutionField).toContainText("1280 × 720");
  await page.getByRole("combobox", { name: "尺寸", exact: true }).click();
  await expect(
    page
      .locator(".ant-select-dropdown:visible")
      .getByText("2048 × 2048", { exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("1824 × 1024", { exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "比例", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("combobox", { name: "质量", exact: true }).click();
  const qualityOptions = page.locator(".ant-select-dropdown:visible");
  await expect(
    qualityOptions.getByText("快速草稿", { exact: true }),
  ).toBeVisible();
  await expect(qualityOptions.getByText("标准", { exact: true })).toBeVisible();
  await expect(
    qualityOptions.getByText("高质量", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "比例", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^1:1$/ })
    .click();
  await page.getByRole("combobox", { name: "图片张数", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await expect(
    page.locator(".direct-creation .field").filter({
      has: page.getByRole("combobox", { name: "图片张数", exact: true }),
    }),
  ).toContainText("2 张");
  await expect(page.getByLabel("宽度", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "自定义尺寸", exact: true }).click();
  await expect(page.getByLabel("宽度", { exact: true })).toBeEnabled();
  await page.getByLabel("宽度", { exact: true }).fill("1008");
  await expect(resolutionField).toContainText("1008 × 1024");
  await page.getByLabel("宽度", { exact: true }).fill("1024");
  await page.getByRole("button", { name: "自定义尺寸", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "格式", exact: true }),
  ).toBeVisible();
  const restrictedUsage = async (route: import("@playwright/test").Route) => {
    const response = await route.fetch();
    const usage = await response.json();
    const restrict = (cap: any) => ({
      ...cap,
      formats: ["png"],
      qualities: ["medium", "high"],
      sizes: ["1024x1024"],
    });
    await route.fulfill({
      response,
      json: {
        ...usage,
        policy: { ...usage.policy, maxQuality: "medium" },
        capabilities: usage.capabilities.map(restrict),
        modelOptions: usage.modelOptions?.map((model: any) => ({
          ...model,
          image: model.image ? restrict(model.image) : undefined,
        })),
      },
    });
  };
  await page.route("**/api/images/usage", restrictedUsage);
  for (const name of ["质量", "格式", "比例", "尺寸"]) {
    await expect(
      page.getByRole("combobox", { name, exact: true }),
    ).toBeDisabled();
  }
  await page.unroute("**/api/images/usage", restrictedUsage);
  await expect(
    page.getByRole("combobox", { name: "质量", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "后台执行与计费", exact: true })
    .click();
  await expect(
    page.getByText(
      "提交后可关闭页面，任务在后台继续。取消可能仍计费；后台中断后不自动续跑，已保存结果会保留。",
      { exact: true },
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("创作需求").fill("合成测试：关闭页面后继续执行");
  await expect(
    page
      .locator(".direct-creation .field")
      .filter({
        has: page.getByRole("combobox", { name: "风格", exact: true }),
      })
      .getByText("真实摄影 · 本次创作", { exact: true }),
  ).toBeVisible();

  let releaseSubmission!: () => void;
  const submissionGate = new Promise<void>((resolve) => {
    releaseSubmission = resolve;
  });
  await page.route(
    "**/api/images/tasks",
    async (route) => {
      expect(route.request().postDataJSON().style).toEqual({
        name: "真实摄影",
        text: "合成风格：柔和自然光",
      });
      expect(route.request().postDataJSON().prompt).toBe(
        "合成测试：关闭页面后继续执行",
      );
      const response = await route.fetch();
      await submissionGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "图片生成状态" }),
  ).toContainText("正在提交图片任务");
  await expect(
    page.locator(".direct-creation .generation-submit-row > .primary"),
  ).toHaveClass(/ant-btn-loading/);
  releaseSubmission();
  await expect(
    page.getByRole("status", { name: "图片生成状态" }),
  ).toContainText(/正在生成图片|排队中/);
  await expect(page.getByLabel("创作需求")).toHaveValue(
    "合成测试：关闭页面后继续执行",
  );
  await expect(
    page.locator(".direct-creation .generation-submit-row > .primary"),
  ).toHaveClass(/ant-btn-loading/);
  const progressBefore = (await page
    .getByLabel("画布生成进度", { exact: true })
    .boundingBox())!;
  await page.getByRole("button", { name: "Zoom Out", exact: true }).click();
  const progressAfter = (await page
    .getByLabel("画布生成进度", { exact: true })
    .boundingBox())!;
  expect(Math.abs(progressBefore.x - progressAfter.x)).toBeLessThan(2);
  expect(Math.abs(progressBefore.y - progressAfter.y)).toBeLessThan(2);
  await page.getByRole("button", { name: "查看任务", exact: true }).click();
  await expect(
    page
      .locator(".canvas-task-history")
      .getByText("合成测试：关闭页面后继续执行", { exact: true }),
  ).toBeVisible();
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 1440, height: 900 });
  await reopened.goto(projectUrl);
  await reopened
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await expect(
    reopened.locator(".canvas-task-history .task-tile-state.state-succeeded"),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).toHaveCount(0);
  await expect(reopened.locator(".ant-notification-notice")).toHaveCount(0, {
    timeout: 8000,
  });
  await reopened.reload();
  await reopened
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await expect(
    reopened.locator(".canvas-task-history .task-tile-state.state-succeeded"),
  ).toHaveCount(1);
  await expect(reopened.locator(".ant-notification-notice")).toHaveCount(0);
  await expect(
    reopened
      .locator(".canvas-task-history")
      .getByRole("link", { name: "下载原图" }),
  ).toHaveCount(2);
  await reopened
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await reopened.getByRole("button", { name: "Fit View", exact: true }).click();
  await reopened.locator(".react-flow__node-image").first().click();
  await reopened
    .getByRole("button", { name: "引用选中 1 张", exact: true })
    .click();
  await expect(
    reopened.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  await reopened
    .getByTestId("reference-upload")
    .getByRole("button", { name: /移除引用/ })
    .click();
  await reopened
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  // Reusing a task is an editable draft; preview and reference actions must not dispatch work.
  const taskDetails = reopened
    .getByRole("button", { name: "任务详情", exact: true })
    .first();
  await taskDetails.click();
  await reopened
    .locator(".task-tile-details .ant-collapse-header")
    .first()
    .click();
  await expect(reopened.locator(".task-tile-details")).toContainText(
    "合成风格：柔和自然光",
  );
  await reopened.keyboard.press("Escape");
  await expect(taskDetails).toHaveAttribute("aria-expanded", "false");
  await expect(taskDetails).toBeFocused();
  await taskDetails.click();
  await reopened.getByRole("button", { name: "复用设置", exact: true }).click();
  await reopened
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(reopened.getByLabel("创作需求")).toHaveValue(
    "合成测试：关闭页面后继续执行",
  );
  await expect(
    reopened.locator(".direct-creation .field").filter({
      has: reopened.getByRole("combobox", { name: "风格", exact: true }),
    }),
  ).toContainText("真实摄影 · 本次创作");
  await reopened.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(reopened.getByLabel("风格描述", { exact: true })).toHaveValue(
    "合成风格：柔和自然光",
  );
  await reopened.getByLabel("风格描述", { exact: true }).press("Escape");
  await expect(
    reopened.locator(".direct-creation .field").filter({
      has: reopened.getByRole("combobox", { name: "图片张数", exact: true }),
    }),
  ).toContainText("2 张");
  await expect(reopened.getByLabel("比例")).toBeVisible();
  await reopened.locator(".output-grid .ant-image").first().click();
  await expect(reopened.locator(".ant-image-preview")).toBeVisible();
  await reopened.keyboard.press("Escape");
  await expect(reopened.locator(".ant-image-preview")).toBeHidden();
  await reopened.locator(".task-tile-images figure").first().hover();
  await reopened
    .locator(".task-tile-images")
    .first()
    .getByRole("button", { name: "更多图片操作", exact: true })
    .first()
    .click();
  await reopened
    .getByRole("menuitem", { name: "作为参考图", exact: true })
    .click();
  await expect(
    reopened
      .getByTestId("reference-upload")
      .getByRole("img", { name: "画布参考图", exact: true }),
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "移除引用 画布参考图", exact: true })
    .click();
  await expect(reopened.locator(".task-result")).toHaveCount(1);
  await reopened.getByLabel("创作需求").fill("合成测试：注销后继续");
  await reopened.getByRole("combobox", { name: "风格", exact: true }).click();
  await reopened
    .locator(".ant-select-dropdown:visible")
    .getByText("海报视觉", { exact: true })
    .click();
  const rejectedDraft = await reopened.getByLabel("创作需求").inputValue();
  await reopened.route(
    "**/api/images/tasks",
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: { code: "IMAGE_QUOTA", requestId: "synthetic-rejection" },
        },
      }),
    { times: 1 },
  );
  await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .click();
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).toContainText("本次图片任务未提交");
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).not.toContainText("已生成");
  await expect(reopened.getByLabel("创作需求")).toHaveValue(rejectedDraft);
  await expect(
    reopened.getByRole("button", { name: "查找这次提交", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await reopened.request.get(
          `/api/images/tasks?projectId=${projectUrl.split("/").at(-1)}`,
        )
      ).json()
    ).tasks,
  ).toHaveLength(1);
  const styledRequest = reopened.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/images/tasks",
  );
  await reopened.route(
    "**/api/images/tasks",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await reopened
    .getByRole("combobox", { name: "图片张数", exact: true })
    .click();
  await reopened
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .click();
  const sentStyleRequest = (await styledRequest).postDataJSON();
  expect(sentStyleRequest.prompt).toBe("合成测试：注销后继续");
  expect(sentStyleRequest.style.name).toBe("海报视觉");
  expect(sentStyleRequest.style.text).toContain("采用海报式视觉组织");
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).toContainText("提交结果待确认");
  await reopened
    .getByRole("button", { name: "查找这次提交", exact: true })
    .click();
  await expect(reopened.getByLabel("创作需求")).toHaveValue(
    "合成测试：注销后继续",
  );
  expect(
    (
      await (
        await reopened.request.get(
          `/api/images/tasks?projectId=${projectUrl.split("/").at(-1)}`,
        )
      ).json()
    ).tasks,
  ).toHaveLength(2);
  await expect(
    reopened
      .locator(".canvas-task-history")
      .getByText("合成测试：注销后继续", { exact: true }),
  ).toBeVisible();
  await reopened.reload();
  await logoutFromMenu(reopened);
  await expect(
    reopened.getByRole("heading", { name: "登录图一乐" }),
  ).toBeVisible();
  await login(reopened);
  await reopened.goto(projectUrl);
  await reopened
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await expect(
    reopened.locator(".canvas-task-history .task-tile-state.state-succeeded"),
  ).toHaveCount(2, { timeout: 15000 });
  const png = (await import("sharp")).default;
  const bytes = await png({
    create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
  })
    .png()
    .toBuffer();
  const promptBeforeReferences = (await reopened
    .getByLabel("创作需求", { exact: true })
    .boundingBox())!.height;
  await reopened
    .getByTestId("reference-upload")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await expect(
    reopened
      .getByTestId("reference-upload")
      .getByRole("img", { name: "synthetic.png", exact: true }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "上传参考图", exact: true }),
  ).toBeVisible();
  await reopened.locator(".task-tile-images figure").first().hover();
  await reopened
    .locator(".task-tile-images")
    .first()
    .getByRole("button", { name: "更多图片操作", exact: true })
    .first()
    .click();
  await reopened
    .getByRole("menuitem", { name: "作为参考图", exact: true })
    .click();
  const referenceItems = reopened
    .getByTestId("reference-upload")
    .locator(".attachment");
  await expect(referenceItems).toHaveCount(2);
  const referenceBoxes = await referenceItems.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, y: box.y, height: box.height };
    }),
  );
  expect(referenceBoxes[0]!.y).toBeCloseTo(referenceBoxes[1]!.y, 0);
  expect(referenceBoxes[1]!.x).toBeGreaterThan(referenceBoxes[0]!.x);
  expect(referenceBoxes[0]!.height).toBe(64);
  expect(
    (await reopened.getByLabel("创作需求", { exact: true }).boundingBox())!
      .height,
  ).toBeCloseTo(promptBeforeReferences, 0);
  const referenceFonts = await reopened
    .locator(
      ".direct-creation .editor-field-label, .direct-creation .image-controls > .field > label",
    )
    .evaluateAll((labels) =>
      labels.map((label) => {
        const style = getComputedStyle(label);
        return `${style.fontSize}/${style.fontWeight}/${style.color}`;
      }),
    );
  expect(new Set(referenceFonts).size).toBe(1);
  await reopened
    .getByRole("button", { name: "移除引用 画布参考图", exact: true })
    .click();
  await expect(referenceItems).toHaveCount(1);
  for (const height of [720, 900, 1080]) {
    await reopened.setViewportSize({ width: 1440, height });
    await expect
      .poll(async () => {
        const prompt = (await reopened
          .getByLabel("创作需求", { exact: true })
          .boundingBox())!;
        const submit = (await reopened
          .getByRole("button", { name: "提交图片任务", exact: true })
          .boundingBox())!;
        return (
          prompt.height >= 140 &&
          prompt.height <= 280 &&
          submit.y + submit.height <= height
        );
      })
      .toBe(true);
  }
  await reopened.setViewportSize({ width: 1440, height: 900 });
  await reopened.getByLabel("创作需求").fill("合成测试：参考图");
  await reopened
    .getByRole("combobox", { name: "图片张数", exact: true })
    .click();
  await reopened
    .locator(".ant-select-dropdown:visible")
    .getByText("1 张", { exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .click();
  await expect(
    reopened.locator(".canvas-task-history .task-tile-state.state-succeeded"),
  ).toHaveCount(3, { timeout: 15000 });
  const completionNotice = reopened.locator(".ant-notification-notice");
  await expect(completionNotice).toContainText("已生成 1 张");
  await expect(
    completionNotice.getByRole("button", { name: "查看任务", exact: true }),
  ).toBeVisible();
  await expect(completionNotice).toBeHidden({ timeout: 8000 });
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).toHaveCount(0);
  await reopened.screenshot({
    path: ".codex-temp/stage2-desktop-workbench.png",
    fullPage: true,
  });
  const submitBox = await reopened
    .getByRole("button", { name: "提交图片任务", exact: true })
    .boundingBox();
  const quotaBox = await reopened.locator("header .header-usage").boundingBox();
  expect(submitBox).not.toBeNull();
  expect(quotaBox).not.toBeNull();
  expect(quotaBox!.y).toBeLessThan(submitBox!.y);
  await expect(reopened.locator(".creation-panel .quota-details")).toHaveCount(
    0,
  );
  const taskCards = reopened.locator(".canvas-task-history .task-result");
  const cardLayout = await taskCards.evaluateAll((cards) =>
    cards.map((card) => {
      const r = card.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        overflow: card.scrollWidth > card.clientWidth,
      };
    }),
  );
  expect(cardLayout.length).toBe(3);
  expect(cardLayout.every((card) => !card.overflow)).toBe(true);
  expect(cardLayout[0]!.width).toBeLessThan(280);
  expect(Math.abs(cardLayout[0]!.y - cardLayout[2]!.y)).toBeLessThan(2);
  expect(Math.abs(cardLayout[0]!.y - cardLayout[1]!.y)).toBeLessThan(2);
  expect(cardLayout[1]!.x).toBeGreaterThan(cardLayout[0]!.x);
  const quotaTrigger = reopened.locator("header .header-usage");
  await quotaTrigger.focus();
  await reopened.keyboard.press("Enter");
  await expect(quotaTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(reopened.getByRole("tooltip")).toBeVisible();
  await reopened.keyboard.press("Escape");
  await expect(reopened.getByRole("tooltip")).toBeHidden();
  await expect(quotaTrigger).toBeFocused();
  await quotaTrigger.click();
  await reopened
    .getByRole("button", { name: "关闭额度详情", exact: true })
    .click();
  await expect(quotaTrigger).toBeFocused();
  await expect(quotaTrigger).toHaveAttribute("aria-expanded", "false");
  await selectCreationPanel(reopened, "agent");
  await expect(reopened.getByRole("tooltip")).toBeHidden();
  await selectCreationPanel(reopened, "direct");
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
  await reopened.getByRole("link", { name: "额度", exact: true }).click();
  await expect(
    reopened.getByRole("heading", { name: "我的额度" }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("link", { name: "管理图片", exact: true }),
  ).toBeVisible();
  await reopened.getByRole("link", { name: "模型服务", exact: true }).click();
  await expect(
    reopened.getByRole("heading", { name: "模型服务" }),
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

test("desktop administration publishes service model pools and preserves versioned skills", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto("/admin/images");
  await page.getByRole("button", { name: "接入现有配置", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "可用模型", exact: true }),
  ).toHaveCount(0);
  const conversationPoolBox = (await page
    .getByRole("region", { name: "对话模型池", exact: true })
    .boundingBox())!;
  const imagePoolBox = (await page
    .getByRole("region", { name: "图像生成模型池", exact: true })
    .boundingBox())!;
  expect(conversationPoolBox.y).toBeCloseTo(imagePoolBox.y, 0);
  expect(imagePoolBox.x).toBeGreaterThan(conversationPoolBox.x);
  await page.getByRole("button", { name: "添加对话模型", exact: true }).click();
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await page
    .getByRole("dialog", { name: "添加对话模型", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  // A long administration page must scroll underneath the shared navigation.
  await page.getByRole("tab", { name: "运行与核验", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存规划策略" }),
  ).toBeAttached();
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const collapsed of [false, true]) {
      if (collapsed)
        await page.getByRole("button", { name: "收起导航" }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const header = page.locator(".main-column > header");
      const before = await header.boundingBox();
      expect(before!.height).toBe(48);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(100);
      const after = await header.boundingBox();
      expect(after!.y).toBe(before!.y);
      await expect(
        header.getByRole("button", { name: "账户菜单" }),
      ).toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, 0));
      if (collapsed)
        await page.getByRole("button", { name: "展开导航" }).click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "模型服务", exact: true }).click();
  await page.getByRole("button", { name: "添加对话模型", exact: true }).click();
  await page
    .getByRole("button", { name: "将 test-planner 加入对话池", exact: true })
    .click();
  const chatPool = page.getByRole("region", {
    name: "对话模型池",
    exact: true,
  });
  await chatPool.getByRole("button", { name: "能力设置", exact: true }).click();
  await page.getByRole("button", { name: "高级设置", exact: true }).click();
  await page
    .getByLabel("单次规划总输出 token 预算", { exact: true })
    .fill("8192");
  await page.getByLabel("支持参考图理解", { exact: true }).check();
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(
    page.getByLabel("单次规划总输出 token 预算", { exact: true }),
  ).toHaveValue("4096");
  await expect(
    page.getByLabel("单次规划输入字符上限", { exact: true }),
  ).toHaveValue("32000");
  await expect(
    page.getByLabel("支持参考图理解", { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("支持参考图理解", { exact: true }).check();
  await page
    .getByRole("button", { name: "应用到待发布配置", exact: true })
    .click();
  const imagePool = page.getByRole("region", {
    name: "图像生成模型池",
    exact: true,
  });
  await imagePool
    .getByRole("button", { name: "能力设置", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "按模型范围开放", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("radio", { name: "仅开放指定尺寸", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "应用到待发布配置", exact: true }),
  ).toBeDisabled();
  await page.getByRole("combobox", { name: "允许的尺寸", exact: true }).click();
  await page
    .getByRole("combobox", { name: "允许的尺寸", exact: true })
    .fill("512");
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
    .filter({ hasText: /^512 × 512$/ })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(page.locator(".model-size-selector")).toContainText(
    "1024 × 1024",
  );
  await expect(page.getByLabel("模型最大边长", { exact: true })).toHaveValue(
    "1024",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await imagePool
    .getByRole("button", { name: "能力设置", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "按模型范围开放", exact: true }),
  ).toBeChecked();
  await page.getByLabel("模型最大边长", { exact: true }).fill("2048");
  await page
    .getByRole("radio", { name: "仅开放指定尺寸", exact: true })
    .check();
  const abilitySave = await page
    .getByRole("button", { name: "应用到待发布配置", exact: true })
    .boundingBox();
  expect(abilitySave!.y + abilitySave!.height).toBeLessThanOrEqual(1000);
  await page.getByRole("combobox", { name: "允许的尺寸", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
    .filter({ hasText: /^1024 × 1024$/ })
    .click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "添加自定义尺寸", exact: true })
    .click();
  await page.getByLabel("自定义宽度", { exact: true }).fill("4096");
  await expect(
    page.getByRole("button", { name: "添加尺寸", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("自定义宽度", { exact: true }).fill("512");
  await page.getByLabel("自定义高度", { exact: true }).fill("512");
  await page.getByRole("button", { name: "添加尺寸", exact: true }).click();
  await expect(page.locator(".model-size-selector")).toContainText("512 × 512");
  await page.getByLabel("支持格式", { exact: true }).click();
  const formatMenu = page.locator(".ant-select-dropdown:visible");
  await expect(formatMenu).toBeVisible();
  const formatBox = await formatMenu.boundingBox();
  expect(formatBox!.y + formatBox!.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "应用到待发布配置", exact: true })
    .click();
  await page.getByRole("tab", { name: "技能与工具", exact: true }).click();
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

  await page.getByLabel("技能名称").fill("待保存的技能");
  await page.getByRole("tab", { name: "模型服务", exact: true }).click();
  await expect(
    chatPool.getByText("test-planner", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加对话模型", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "将 test-planner 加入对话池",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("dialog", { name: "添加对话模型", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "保存开放配置", exact: true }).click();
  await expect(page.getByText("模型配置已保存", { exact: true })).toBeVisible();
  const catalog = await (
    await page.request.get("/api/model-admin/catalog")
  ).json();
  expect(
    catalog.entries.find((e: any) => e.kind === "image").image.sizes,
  ).toEqual(["1024x1024", "512x512"]);
  await page.getByRole("tab", { name: "技能与工具", exact: true }).click();
  await expect(page.getByLabel("技能名称")).toHaveValue("待保存的技能");
  await page.getByRole("tab", { name: "模型服务", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".codex-temp/model-pools-admin-1440.png",
    fullPage: true,
  });
});

test("desktop canvas saves geometry, handles conflicts and never replaces removed outputs", async ({
  page,
}) => {
  test.setTimeout(150000);
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
  const imageActions = page.locator(
    `.react-flow__node-toolbar[data-id="${first.document.nodes[0].id}"]`,
  );
  await page.mouse.move(5, 5);
  await expect(imageActions).toHaveCSS("opacity", "0");
  const imageGeometry = await node.evaluate((element) => {
    const outer = element.getBoundingClientRect(),
      image = element.querySelector("img")!.getBoundingClientRect();
    return {
      width: Math.abs(outer.width - image.width),
      height: Math.abs(outer.height - image.height),
    };
  });
  expect(imageGeometry.width).toBeLessThan(1);
  expect(imageGeometry.height).toBeLessThan(1);
  await node.hover();
  await expect(imageActions).toHaveCSS("opacity", "1");
  await imageActions
    .getByRole("button", { name: "查看原图", exact: true })
    .click();
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
  const downloadAction = imageActions.getByRole("link", {
    name: "下载原图",
    exact: true,
  });
  await page.mouse.move(5, 5);
  await downloadAction.focus();
  await expect(downloadAction).toBeFocused();
  await expect(imageActions).toHaveCSS("opacity", "1");
  await expect(downloadAction).toHaveAttribute(
    "href",
    `/api/images/assets/${first.document.nodes[0].assetId}/download`,
  );
  await imageActions
    .getByRole("button", { name: "复用图片设置", exact: true })
    .click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "合成画布图片",
  );
  await page.getByLabel("创作需求", { exact: true }).fill("");
  await node.hover();
  await imageActions
    .getByRole("button", { name: "作为参考图", exact: true })
    .click();
  await expect(
    page
      .getByTestId("reference-upload")
      .getByRole("img", { name: "画布参考图", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "移除引用 画布参考图", exact: true })
    .click();
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(1);
  const fullButton = await imageActions
    .getByRole("button", { name: "查看原图", exact: true })
    .boundingBox();
  expect(fullButton!.width).toBeCloseTo(28, 0);
  expect(fullButton!.height).toBeCloseTo(28, 0);
  for (let i = 0; i < 4; i++) {
    const zoom = (await savedCanvas()).document.viewport.zoom;
    await page.getByRole("button", { name: "Zoom Out", exact: true }).click();
    await expect
      .poll(async () => (await savedCanvas()).document.viewport.zoom)
      .toBeLessThan(zoom);
  }
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await expect(node).not.toHaveClass(/selected/);
  await node.hover();
  const more = imageActions.getByRole("button", {
    name: "更多图片操作",
    exact: true,
  });
  await expect(more).toBeVisible();
  const smallButton = (await more.boundingBox())!;
  expect(smallButton.width).toBeCloseTo(fullButton!.width, 0);
  expect(smallButton.height).toBeCloseTo(fullButton!.height, 0);
  const smallImage = (await node.boundingBox())!;
  expect(smallButton.x).toBeGreaterThanOrEqual(smallImage.x);
  expect(smallButton.y).toBeGreaterThanOrEqual(smallImage.y);
  expect(smallButton.x + smallButton.width).toBeLessThanOrEqual(
    smallImage.x + smallImage.width,
  );
  await more.hover();
  await expect(imageActions).toHaveCSS("opacity", "1");
  await expect(node).not.toHaveClass(/selected/);
  await more.click();
  const imageMenu = page.getByRole("menu");
  await expect(
    imageMenu.getByRole("link", { name: "下载原图", exact: true }),
  ).toHaveAttribute(
    "href",
    `/api/images/assets/${first.document.nodes[0].assetId}/download`,
  );
  await imageMenu.getByRole("menuitem", { name: "预览", exact: true }).click();
  await expect(imageMenu).toBeHidden();
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
  await node.hover();
  await more.click();
  await imageMenu
    .getByRole("menuitem", { name: "复用设置", exact: true })
    .click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "合成画布图片",
  );
  await page.getByLabel("创作需求", { exact: true }).fill("");
  await node.hover();
  await more.click();
  await imageMenu
    .getByRole("menuitem", { name: "作为参考图", exact: true })
    .click();
  await expect(
    page
      .getByTestId("reference-upload")
      .getByRole("img", { name: "画布参考图", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "移除引用 画布参考图", exact: true })
    .click();
  for (let i = 0; i < 4; i++) {
    const zoom = (await savedCanvas()).document.viewport.zoom;
    await page.getByRole("button", { name: "Zoom In", exact: true }).click();
    await expect
      .poll(async () => (await savedCanvas()).document.viewport.zoom)
      .toBeGreaterThan(zoom);
  }
  await expect(
    imageActions.getByRole("button", { name: "查看原图", exact: true }),
  ).toBeVisible();
  expect((await savedCanvas()).document.nodes).toEqual(first.document.nodes);
  const beforePan = await savedCanvas();
  const pane = (await page.locator(".react-flow__pane").boundingBox())!;
  async function savedCanvas() {
    return (await page.request.get(`/api/projects/${projectId}/canvas`)).json();
  }
  async function dragAt(x: number, y: number) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 30, { steps: 10 });
    await page.mouse.up();
  }
  await dragAt(pane.x + pane.width - 120, pane.y + 90);
  await expect
    .poll(async () => (await savedCanvas()).document.viewport.x)
    .not.toBe(beforePan.document.viewport.x);
  const afterBlank = await savedCanvas();
  expect(afterBlank.document.nodes).toEqual(first.document.nodes);
  await page.getByRole("button", { name: "拖拽工具", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "拖拽工具", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const handNode = (await node.boundingBox())!;
  await dragAt(handNode.x + 70, handNode.y + 70);
  await expect
    .poll(async () => (await savedCanvas()).document.viewport.x)
    .not.toBe(afterBlank.document.viewport.x);
  const afterHand = await savedCanvas();
  expect(afterHand.document.nodes).toEqual(first.document.nodes);
  await page.getByRole("button", { name: "选择工具", exact: true }).click();
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: pane.width - 120, y: 90 } });
  await page.keyboard.down("Space");
  const spaceNode = (await node.boundingBox())!;
  await dragAt(spaceNode.x + 70, spaceNode.y + 70);
  await page.keyboard.up("Space");
  await expect
    .poll(async () => (await savedCanvas()).document.viewport.x)
    .not.toBe(afterHand.document.viewport.x);
  expect((await savedCanvas()).document.nodes).toEqual(first.document.nodes);
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
  await page.getByRole("link", { name: "查看额度", exact: true }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByText(/未能保存画布/)).toBeVisible();
  let passwordCalls = 0;
  await page.route("**/api/auth/password", async (route) => {
    passwordCalls++;
    await route.abort();
  });
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "修改密码", exact: true }).click();
  const passwordDialog = page.getByRole("dialog", {
    name: "修改密码",
    exact: true,
  });
  await passwordDialog
    .getByLabel("当前密码")
    .fill("synthetic-current-password");
  await passwordDialog
    .getByLabel("新密码", { exact: true })
    .fill("synthetic-new-password");
  await passwordDialog.getByLabel("确认新密码").fill("synthetic-new-password");
  await passwordDialog.getByRole("button", { name: "保存并重新登录" }).click();
  await expect(passwordDialog.getByRole("alert")).toBeVisible();
  expect(passwordCalls).toBe(0);
  await expect(page).toHaveURL(projectUrl);
  await passwordDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(passwordDialog).toBeHidden();
  await page.unroute("**/api/auth/password");
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
    await expect
      .poll(() =>
        page
          .locator(".shell")
          .evaluate(
            (el) =>
              el
                .getAnimations()
                .filter((animation) => animation.playState === "running")
                .length,
          ),
      )
      .toBe(0);
    const panel = (await page.locator(".creation-panel").boundingBox())!;
    const canvas = (await page.locator(".canvas-surface").boundingBox())!;
    const navigation = (await page.locator(".sidebar").boundingBox())!;
    const submit = (await page
      .getByRole("button", { name: "提交图片任务", exact: true })
      .boundingBox())!;
    const quota = (await page.locator("header .header-usage").boundingBox())!;
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
  // This scenario must also run alone, without the model-administration test.
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  let catalog = await (
    await page.request.get("/api/model-admin/catalog")
  ).json();
  if (!catalog.managed) {
    expect(
      (
        await page.request.post("/api/model-admin/bootstrap", {
          headers,
          data: {},
        })
      ).ok(),
    ).toBe(true);
    catalog = await (await page.request.get("/api/model-admin/catalog")).json();
  }
  if (
    !catalog.entries.some(
      (entry: any) => entry.kind === "conversation" && entry.enabled,
    )
  ) {
    const service = catalog.services.find(
      (service: any) => service.mode === "fake",
    );
    expect(service).toBeTruthy();
    expect(
      (
        await page.request.post(
          `/api/model-admin/services/${service.id}/refresh`,
          { headers, data: {} },
        )
      ).ok(),
    ).toBe(true);
    catalog = await (await page.request.get("/api/model-admin/catalog")).json();
    expect(
      (
        await page.request.post("/api/model-admin/pools", {
          headers,
          data: {
            revision: catalog.revision,
            entries: [
              ...catalog.entries,
              {
                id: randomUUID(),
                serviceId: service.id,
                modelId: "test-planner",
                kind: "conversation",
                enabled: true,
                isDefault: true,
                conversation: {
                  supportsImages: true,
                  responseMode: "json_object",
                  maxOutputTokens: 4096,
                  maxInputCharacters: 32000,
                },
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("Agent 顺序创作");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "Agent 顺序创作" })
    .click();
  const projectId = page.url().split("/").at(-1)!;
  await selectCreationPanel(page, "agent");
  await page.getByRole("button", { name: "灵感与风格", exact: true }).click();
  await expect(
    page
      .getByRole("tooltip")
      .getByRole("button", { name: "简洁商品展示", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "灵感与风格", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "灵感与风格", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "创作设置", exact: true }).click();
  await page.getByRole("button", { name: "创作设置", exact: true }).click();
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
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  await expect(page.getByLabel("计划步骤摘要")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".agent-confirm-footer")).toContainText("确认执行");
  const executionHelp = page
    .locator(".agent-confirm-footer")
    .getByRole("button", { name: "执行说明", exact: true });
  await executionHelp.click();
  await expect(page.getByRole("tooltip")).toContainText("取消可能计费");
  await executionHelp.press("Escape");

  await expect(
    page.getByLabel("告诉 Agent 你的想法", { exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "继续聊想法", exact: true }).click();
  await expect(
    page.getByLabel("告诉 Agent 你的想法", { exact: true }),
  ).toHaveValue("合成验收：先生成基准图，再参考基准图改图");
  await page.getByRole("button", { name: "继续聊想法", exact: true }).click();
  await expect(page.getByLabel("步骤 1 提示词", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "编辑提示词", exact: true }).click();
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
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "步骤 1 张数", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await page.getByRole("button", { name: "添加步骤", exact: true }).click();
  await page
    .getByRole("button", { name: "步骤 2 图片设置", exact: true })
    .click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "步骤 2 张数", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("1 张", { exact: true })
    .click();
  await page.getByLabel("使用上一步第一张图片").check();
  await page
    .getByRole("button", { name: "步骤 2 图片设置", exact: true })
    .click();
  await expect(
    page.getByText("本计划预留 3 张图片", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存计划修改", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/agent/jobs?projectId=${projectId}`)
          ).json()
        ).jobs[0].plans.at(-1).version,
    )
    .toBe(2);
  await page.reload();
  await selectCreationPanel(page, "agent");
  await expect(page.getByLabel("计划步骤摘要")).toBeVisible();
  await page.getByRole("button", { name: "编辑提示词", exact: true }).click();
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await expect(
    page.locator(".field").filter({
      has: page.getByRole("combobox", { name: "步骤 1 张数", exact: true }),
    }),
  ).toContainText("2 张");
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await page
    .getByRole("button", { name: "步骤 2 图片设置", exact: true })
    .click();
  await expect(page.getByLabel("使用上一步第一张图片")).toBeChecked();
  await page
    .getByRole("button", { name: "步骤 2 图片设置", exact: true })
    .click();
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toEqual([]);
  await page.getByRole("button", { name: "返回方案", exact: true }).click();
  await expect(page.getByLabel("计划步骤摘要").locator("li")).toHaveCount(2);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1536, height: 960 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const card = document
            .querySelector(".agent-plan-form")!
            .getBoundingClientRect();
          const conversation = document
            .querySelector(".agent-conversation")!
            .getBoundingClientRect();
          return {
            visible:
              card.top >= conversation.top - 1 &&
              card.bottom <= conversation.bottom + 1,
            card: { top: card.top, bottom: card.bottom, height: card.height },
            conversation: {
              top: conversation.top,
              bottom: conversation.bottom,
              height: conversation.height,
            },
            viewport: { width: innerWidth, height: innerHeight },
          };
        }),
      )
      .toMatchObject({ visible: true });
  }
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
  await expect(
    page.getByRole("button", { name: "查看提示词", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "步骤 1 图片设置", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3);
  await selectCreationPanel(page, "agent");
  await expect(page.getByText("计划已确认", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    animations: "disabled",
    path: ".codex-temp/m3-agent-result-1920.png",
  });
  const completedTasks = (
    await (
      await page.request.get(`/api/images/tasks?projectId=${projectId}`)
    ).json()
  ).tasks;
  const dependentTask = completedTasks.find((task: any) => task.count === 1);
  expect(dependentTask.settings.referenceIds).toHaveLength(2);
  await page
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await page
    .locator(".task-result")
    .filter({
      has: page.locator(
        `img[src="/api/images/assets/${dependentTask.outputs[0].id}/preview"]`,
      ),
    })
    .getByRole("button", { name: "任务详情", exact: true })
    .click();
  await page.getByRole("button", { name: "复用设置", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    dependentTask.prompt,
  );
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(2);
  for (const id of dependentTask.settings.referenceIds)
    await expect(
      page
        .getByTestId("reference-upload")
        .locator(`img[src="/api/images/assets/${id}/preview"]`),
    ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(2);
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
  if (
    !(await (await page.request.get("/api/library/assets")).json()).assets
      .length
  ) {
    const session = await (await page.request.get("/api/auth/me")).json();
    const png = await (
      await import("sharp")
    )
      .default({
        create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
      })
      .png()
      .toBuffer();
    expect(
      (
        await page.request.post("/api/images/uploads", {
          headers: {
            Origin: "http://127.0.0.1:5180",
            "X-CSRF-Token": session.csrfToken,
            "Content-Type": "image/png",
          },
          data: png,
        })
      ).status(),
    ).toBe(201);
  }
  const before = await (await page.request.get("/api/images/usage")).json();
  await page.getByRole("link", { name: "图库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的图库", exact: true }),
  ).toBeVisible();
  const card = page.locator(".gallery-card").first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "图片更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "收藏图片", exact: true }).click();
  await page.getByLabel("收藏标题", { exact: true }).fill("素材测试收藏");
  await page.getByLabel("收藏分组名称", { exact: true }).fill("验收分组");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(page.locator(".ant-drawer:visible")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^已收藏$/ }),
  ).toBeVisible();
  await card.getByRole("button", { name: "图片更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除原图", exact: true }).click();
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
  await expect(card).toHaveClass(/is-selected/);
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
  await page
    .locator(".gallery-card")
    .first()
    .getByRole("button", { name: "加入画布", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${targetHref}$`));
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  expect(
    (await (await page.request.get("/api/images/usage")).json()).used,
  ).toBe(before.used);
  await page.getByRole("link", { name: "图库", exact: true }).click();
  await page
    .locator(".gallery-card")
    .first()
    .getByRole("button", { name: "用作参考", exact: true })
    .click();
  await expect(
    page
      .getByTestId("reference-upload")
      .getByRole("button", { name: "图库参考图", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "提示池", exact: true }),
  ).toBeVisible();
  const template = page.locator(".prompt-card").first();
  await template
    .getByRole("button", { name: "收藏提示词", exact: true })
    .click();
  await expect(
    template.getByRole("button", { name: "已收藏提示词", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".ant-drawer:visible")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^已收藏$/ }),
  ).toBeVisible();
  const prompt = (await (await page.request.get("/api/library/prompts")).json())
    .prompts[0].prompt;
  await template
    .getByRole("button", { name: "使用提示词", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "素材复用目标", exact: true })
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
  await favorite
    .getByRole("button", { name: "收藏更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "编辑收藏", exact: true }).click();
  await page.getByLabel("收藏标题", { exact: true }).fill("更新素材收藏");
  await page.getByLabel("收藏分组名称", { exact: true }).fill("归档");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(page.locator(".ant-drawer:visible")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "更新素材收藏", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("complementary", { name: "收藏分组", exact: true })
    .getByRole("checkbox", { name: "归档", exact: true })
    .check();
  await expect(page.locator(".favorite-card")).toHaveCount(1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    path: ".codex-temp/m3-favorites-1920.png",
    animations: "disabled",
  });
  await page
    .locator(".favorite-card")
    .getByRole("button", { name: "收藏更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "移除收藏", exact: true }).click();
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
  await page.getByRole("tab", { name: "运行与核验", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "运行概览与规划策略", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("图片统计日、逐单预留和规划计次对账一致。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("全局规划并发", { exact: true }).fill("3");
  await page.getByLabel("全局规划排队上限", { exact: true }).fill("32");
  await page.getByRole("button", { name: "保存执行设置", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
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
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
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
  await selectCreationPanel(page, "agent");
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
  await page
    .context()
    .storageState({ path: ".codex-temp/model-pools-admin-session.json" });
});

test("administrators add a service and users select same-named models from the correct service", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const savedSession = await readFile(
    ".codex-temp/model-pools-admin-session.json",
    "utf8",
  )
    .then(JSON.parse)
    .catch(() => null);
  if (savedSession) await page.context().addCookies(savedSession.cookies);
  if (!(await page.request.get("/api/auth/me")).ok()) await login(page);
  else await page.goto("/projects");
  await page.goto("/admin/images");
  await page.getByRole("button", { name: "管理服务", exact: true }).click();
  await page.getByRole("button", { name: "新增服务", exact: true }).click();
  await page.getByLabel("服务名称", { exact: true }).fill("备用测试服务");
  await page.getByLabel("接入协议", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("本地合成测试（不调用模型）", { exact: true })
    .click();
  await page.getByRole("button", { name: "保存服务", exact: true }).click();
  await expect(page.getByText("服务已保存", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "添加图片生成模型", exact: true })
    .click();
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await page.getByRole("button", { name: "手动登记模型", exact: true }).click();
  await page.getByLabel("模型 ID", { exact: true }).fill("invalid model");
  await page.getByRole("button", { name: "登记候选模型", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "手动登记模型", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
  await page.getByLabel("模型 ID", { exact: true }).fill("manual-candidate");
  await page.getByRole("button", { name: "登记候选模型", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "手动登记模型", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "将 test-image 加入图像生成池", exact: true })
    .click();
  await page.getByRole("button", { name: "添加对话模型", exact: true }).click();
  await page
    .getByRole("button", { name: "将 test-planner 加入对话池", exact: true })
    .click();
  await page.getByRole("button", { name: "保存开放配置", exact: true }).click();
  await expect(page.getByText("模型配置已保存", { exact: true })).toBeVisible();
  const catalog = await (
    await page.request.get("/api/model-admin/catalog")
  ).json();
  const service = catalog.services.find((s: any) => s.name === "备用测试服务");
  const entry = catalog.entries.find(
    (e: any) => e.serviceId === service.id && e.kind === "image",
  );
  expect(entry.isDefault).toBe(false);
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("多服务选择验收");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "多服务选择验收" })
    .click();
  await page
    .getByLabel("创作需求", { exact: true })
    .fill("Synthetic preserved draft");
  const usageRoute = "**/api/images/usage";
  await page.route(usageRoute, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.modelOptions = body.modelOptions.map((m: any) =>
      m.id === entry.id
        ? {
            ...m,
            image: {
              ...m.image,
              sizes: ["768x1024"],
              qualities: ["low"],
              formats: ["jpeg"],
            },
          }
        : m,
    );
    await route.fulfill({ response, json: body });
  });
  await page.waitForResponse((r) => r.url().endsWith("/api/images/usage"));
  await page.getByLabel("图片模型", { exact: true }).click();
  await page.getByLabel("图片模型", { exact: true }).fill("备用测试服务");
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("test-image · 备用测试服务", { exact: true })
    .click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "Synthetic preserved draft",
  );
  await expect(page.getByLabel("宽度", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "自定义尺寸", exact: true }),
  ).toHaveCount(0);
  for (const name of ["比例", "尺寸", "质量", "格式"]) {
    await expect(
      page.getByRole("combobox", { name, exact: true }),
    ).toBeDisabled();
  }
  await expect(
    page.locator(".direct-creation .field").filter({
      has: page.getByRole("combobox", { name: "尺寸", exact: true }),
    }),
  ).toContainText("768 × 1024");
  await page.unroute(usageRoute);
  await page.waitForResponse((response) =>
    response.url().endsWith("/api/images/usage"),
  );
  for (const [name, option] of [
    ["比例", "1:1"],
    ["质量", "标准"],
    ["格式", "PNG"],
  ]) {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page
      .locator(".ant-select-dropdown:visible")
      .locator(".ant-select-item-option-content")
      .filter({ hasText: new RegExp(`^${option}$`) })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "提交图片任务", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("创作需求", { exact: true })
    .fill("Synthetic service selection");
  const imageRequest = page.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/images/tasks",
  );
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  expect((await imageRequest).postDataJSON().modelSelectionId).toBe(entry.id);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1, {
    timeout: 20000,
  });
  await selectCreationPanel(page, "agent");
  await page.getByRole("button", { name: "创作设置", exact: true }).click();
  await page.getByLabel("对话模型", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("test-planner · 备用测试服务", { exact: true })
    .click();
  await page.getByRole("button", { name: "创作设置", exact: true }).click();
  await page
    .getByLabel("告诉 Agent 你的想法", { exact: true })
    .fill("Synthetic plan using selected service");
  const planningRequest = page.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/agent/planning",
  );
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  await expect(page.getByLabel("计划步骤摘要")).toBeVisible({ timeout: 15000 });
  expect((await planningRequest).postDataJSON().conversationModelId).toBe(
    catalog.entries.find(
      (e: any) => e.serviceId === service.id && e.kind === "conversation",
    ).id,
  );
  const session = await (await page.request.get("/api/auth/me")).json();
  for (let i = 0; i < 12; i++) {
    const response = await page.request.post(
      `/api/model-admin/services/${service.id}/manual`,
      {
        headers: {
          Origin: new URL(page.url()).origin,
          "X-CSRF-Token": session.csrfToken,
        },
        data: {
          modelId: `scroll-${String(i).padStart(2, "0")}-${"long-model-name-".repeat(5)}`,
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await page.getByRole("link", { name: "模型服务", exact: true }).click();
  await page
    .getByRole("region", { name: "服务接入", exact: true })
    .getByRole("combobox", { name: "当前服务", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("备用测试服务", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "添加图片生成模型", exact: true })
    .click();
  const tableBody = page.locator(".model-catalog-candidates .ant-table-body");
  await expect
    .poll(() => tableBody.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await tableBody.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => tableBody.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "模型开放规则", exact: true }).click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  const popup = await page.getByRole("tooltip").boundingBox();
  expect(popup!.x).toBeGreaterThanOrEqual(0);
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(1440);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await page
    .getByRole("dialog", { name: "添加图片生成模型", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "管理服务", exact: true }).click();
  await page.getByRole("button", { name: "更多服务操作", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  const menu = await page.getByRole("menu").boundingBox();
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await page
    .getByRole("dialog", { name: "管理服务", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.screenshot({
    path: ".codex-temp/ui-clarity-models-1440.png",
    fullPage: true,
  });
});

test("user quota inputs align in finite and unlimited modes on desktop", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "admin", exact: true }) })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: /^admin/, exact: false });
  const quota = drawer.getByLabel("每日图片额度", { exact: true });
  const storage = drawer.getByLabel("存储上限（GB）", { exact: true });
  const unlimited = drawer.getByRole("checkbox", {
    name: "不限额",
    exact: true,
  });
  await expect(unlimited).toBeChecked();
  await expect(
    drawer.getByText("管理员 · 当前账号", { exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "更多账号操作", exact: true }),
  ).toHaveCount(0);
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const checked of [false, true]) {
      await unlimited.setChecked(checked);
      await expect
        .poll(async () => {
          const a = await quota.boundingBox(),
            b = await storage.boundingBox();
          return a && b
            ? Math.max(Math.abs(a.y - b.y), Math.abs(a.height - b.height))
            : Infinity;
        })
        .toBeLessThan(1);
      await expect(quota).toHaveJSProperty("disabled", checked);
    }
  }
  await expect(
    drawer.getByRole("button", { name: "保存用户配置", exact: true }),
  ).toBeDisabled();
});

test("user policy draft survives a pending search", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "admin", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route("**/api/admin/users?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("search") === "admin") {
      reached();
      await gate;
    }
    await route.continue();
  });
  await page.getByLabel("搜索用户", { exact: true }).fill("admin");
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "admin", exact: true }) })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: /^admin/ });
  await drawer.getByRole("checkbox", { name: "不限额", exact: true }).uncheck();
  const quota = drawer.getByLabel("每日图片额度", { exact: true });
  await quota.fill("17");
  await requested;
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/admin/users?") &&
      new URL(r.url()).searchParams.get("search") === "admin",
  );
  release();
  await response;
  await expect(quota).toHaveValue("17");
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(drawer).toBeHidden();
});

test("user search reaches older pages and unsaved policies block history and reload", async ({
  page,
}) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  for (const username of [
    "older_search_target",
    ...Array.from({ length: 50 }, (_, i) => `search_user_${i}`),
  ]) {
    expect(
      (
        await page.request.post("/api/admin/users", {
          headers,
          data: { username },
        })
      ).status(),
    ).toBe(201);
  }
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "older_search_target" }),
  ).toHaveCount(0);
  await page
    .getByLabel("搜索用户", { exact: true })
    .fill("OLDER_SEARCH_TARGET");
  await expect(
    page.getByRole("row").filter({ hasText: "older_search_target" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "加载更多账号", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("搜索用户", { exact: true }).fill("admin");
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "admin", exact: true }) })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: /^admin/ });
  await drawer.getByRole("checkbox", { name: "不限额", exact: true }).uncheck();
  const quota = drawer.getByLabel("每日图片额度", { exact: true });
  await quota.fill("17");
  const back = page.goBack();
  const confirmation = page.getByRole("dialog", {
    name: "请确认",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText("有未保存的用户配置，放弃修改并离开页面？", { exact: true }),
  ).toHaveCount(1);
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await back;
  await expect(quota).toHaveValue("17");
  const reloadDialog = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 2000 }).catch(() => null);
  const prompt = await reloadDialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();
  await reload;
  await expect(quota).toHaveValue("17");
  const leave = page.goBack();
  await expect(confirmation).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText("有未保存的用户配置，放弃修改并离开页面？", { exact: true }),
  ).toHaveCount(1);
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await leave;
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("dialog", { name: "请确认", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
});

test("usage dashboard summarizes quotas and refreshes task details without a duplicate gallery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByRole("link", { name: "额度", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的额度", exact: true }),
  ).toBeVisible();
  const imageQuota = page.getByRole("region", {
    name: "图片额度",
    exact: true,
  });
  const storage = page.getByRole("region", { name: "存储空间", exact: true });
  await expect(imageQuota.getByText("不限额", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无使用记录", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "上传的参考图", exact: true }),
  ).toHaveCount(0);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const projectResponse = await page.request.post("/api/projects", {
    headers,
    data: { name: "Usage dashboard synthetic" },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  expect(
    (
      await page.request.post("/api/images/uploads", {
        headers: { ...headers, "Content-Type": "image/png" },
        data: png,
      })
    ).status(),
  ).toBe(201);
  const submitted = await page.request.post("/api/images/tasks", {
    headers,
    data: {
      projectId: project.id,
      requestKey: randomUUID(),
      prompt: "Usage dashboard synthetic image",
      model: "test-image",
      count: 1,
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      referenceIds: [],
    },
  });
  expect(submitted.status()).toBe(202);
  const records = page.getByRole("region", { name: "使用记录", exact: true });
  await expect(
    records.getByRole("button", { name: "查看任务详情", exact: true }),
  ).toHaveCount(1);
  await expect(records.getByRole("img")).toHaveCount(0);
  await records
    .getByRole("button", { name: "查看任务详情", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await expect(
    drawer.getByText("Usage dashboard synthetic image", { exact: true }),
  ).toBeVisible();
  await expect(drawer.getByText("已完成", { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole("img", { name: "已保存图片，256 × 256", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "下载原图", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "删除原图", exact: true }),
  ).toHaveCount(0);
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(
    imageQuota.getByText("已生成 1 张", { exact: true }),
  ).toBeVisible();
  const policy = await (
    await page.request.get(`/api/image-admin/policies/${session.user.id}`)
  ).json();
  expect(
    (
      await page.request.post(`/api/image-admin/policies/${session.user.id}`, {
        headers,
        data: { ...policy, imageLimit: 100 },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "刷新额度", exact: true }).click();
  await expect(imageQuota.getByText("99", { exact: true })).toBeVisible();
  await expect(
    imageQuota.getByRole("progressbar", {
      name: "今日图片额度使用比例",
      exact: true,
    }),
  ).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "额度详情", exact: true }).click();
  await expect(page.getByText("今日模型调用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "额度详情", exact: true }).click();
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const left = await imageQuota.boundingBox(),
      right = await storage.boundingBox();
    expect(left && right).toBeTruthy();
    expect(Math.abs(left!.y - right!.y)).toBeLessThan(1);
    expect(Math.abs(left!.height - right!.height)).toBeLessThan(1);
    await page.screenshot({
      path: `.codex-temp/usage-dashboard-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "管理图片", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的图库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "上传图片 256 × 256", exact: true }),
  ).toBeVisible();
});

test("prompt library keeps project selection compact and reuses full prompts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const projects = [];
  for (const name of ["Prompt first", "Prompt target"]) {
    const response = await page.request.post("/api/projects", {
      headers,
      data: { name },
    });
    expect(response.status()).toBe(201);
    projects.push(await response.json());
  }
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  await expect(page.getByLabel("目标项目", { exact: true })).toHaveCount(0);
  const card = page.locator(".prompt-card").first();
  const prompt = (await (await page.request.get("/api/library/prompts")).json())
    .prompts[0];
  if (
    await card.getByRole("button", { name: "收藏提示词", exact: true }).count()
  )
    await card.getByRole("button", { name: "收藏提示词", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "已收藏提示词", exact: true }),
  ).toBeDisabled();
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const rowSpreads = await page
      .locator(".prompt-card")
      .evaluateAll((cards) => {
        const rows = new Map<number, number[]>();
        for (const card of cards) {
          const top = Math.round(card.getBoundingClientRect().top);
          const bottom = card
            .querySelector(".actions")!
            .getBoundingClientRect().bottom;
          rows.set(top, [...(rows.get(top) ?? []), bottom]);
        }
        return [...rows.values()].map(
          (values) => Math.max(...values) - Math.min(...values),
        );
      });
    expect(Math.max(...rowSpreads)).toBeLessThan(2);
  }
  await card.getByRole("button", { name: "使用提示词", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Prompt target", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projects[1].id}$`));
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    prompt.prompt,
  );
});

test("managed prompt pool supports drafts, publication, cross-tab updates, reuse and private snapshots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: "Template target" },
    })
  ).json();
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  await page.getByRole("link", { name: "管理创作预设", exact: true }).click();
  await page.getByRole("button", { name: "新增提示词", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "新增提示词", exact: true });
  await drawer.getByLabel("标题", { exact: true }).fill("公开模板验收");
  await drawer.getByLabel("分类", { exact: true }).fill("验收");
  await drawer
    .getByLabel("提示词正文", { exact: true })
    .fill("合成模板的完整正文，保留所有内容。");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  await expect(drawer).toBeHidden();
  const row = page.getByRole("row").filter({ hasText: "公开模板验收" });
  await expect(row.getByText("未上架", { exact: true })).toBeVisible();
  const viewer = await page.context().newPage();
  await viewer.goto("/prompts");
  await expect(viewer.locator(".prompt-card")).toHaveCount(36);
  await expect(
    viewer.getByRole("heading", { name: "公开模板验收", exact: true }),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  drawer = page.getByRole("dialog", { name: "编辑提示词", exact: true });
  await drawer
    .getByRole("checkbox", { name: "上架，所有用户可见", exact: true })
    .check();
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  await expect(drawer).toBeHidden();
  const template = viewer
    .locator(".prompt-card")
    .filter({ hasText: "公开模板验收" });
  await expect(template).toBeVisible({ timeout: 20000 });
  await template
    .getByRole("button", { name: "收藏提示词", exact: true })
    .click();
  await expect(
    template.getByRole("button", { name: "已收藏提示词", exact: true }),
  ).toBeDisabled();
  await template
    .getByRole("button", { name: "使用提示词", exact: true })
    .click();
  await viewer
    .getByRole("menuitem", { name: "Template target", exact: true })
    .click();
  await expect(viewer).toHaveURL(new RegExp(`/projects/${project.id}$`));
  await expect(viewer.getByLabel("创作需求", { exact: true })).toHaveValue(
    "合成模板的完整正文，保留所有内容。",
  );
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await drawer
    .getByLabel("提示词正文", { exact: true })
    .fill("修改后的公共正文");
  await drawer
    .getByRole("checkbox", { name: "上架，所有用户可见", exact: true })
    .uncheck();
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  await expect(drawer).toBeHidden();
  await viewer.getByRole("link", { name: "提示池", exact: true }).click();
  await expect(viewer.locator(".prompt-card")).toHaveCount(36);
  const favorites = (
    await (await viewer.request.get("/api/library/favorites")).json()
  ).favorites;
  expect(
    favorites.find((f: { title: string }) => f.title === "公开模板验收").prompt,
  ).toBe("合成模板的完整正文，保留所有内容。");
  // Closing a dirty editor must ask before discarding it.
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await drawer.getByLabel("标题", { exact: true }).fill("未保存修改");
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "请确认",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer.getByLabel("标题", { exact: true })).toHaveValue(
    "未保存修改",
  );
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(drawer).toBeHidden();
  await viewer.close();
});

test("prompt category panel supports multiple selection, deselection and full-catalog filtering", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "提示词分类",
    exact: true,
  });
  const cards = page.locator(".prompt-card");
  await expect(cards).toHaveCount(36);
  await panel.getByRole("checkbox", { name: "商品", exact: true }).check();
  await expect(cards).toHaveCount(4);
  await expect(
    panel.getByRole("checkbox", { name: "摄影", exact: true }),
  ).toBeVisible();
  await panel.getByRole("checkbox", { name: "摄影", exact: true }).check();
  await expect(cards).toHaveCount(8);
  await panel.getByRole("checkbox", { name: "商品", exact: true }).uncheck();
  await expect(cards).toHaveCount(4);
  await expect(
    page.getByRole("heading", { name: "美食自然光摄影", exact: true }),
  ).toBeVisible();
  await panel.getByRole("checkbox", { name: "摄影", exact: true }).uncheck();
  await expect(cards).toHaveCount(36);
  await expect(
    panel.getByRole("button", { name: "全部分类", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("checkbox", { name: "空间", exact: true }).check();
  await expect(cards).toHaveCount(3);
  await panel.getByRole("button", { name: "全部分类", exact: true }).click();
  await expect(cards).toHaveCount(36);
  await expect(
    panel.getByRole("checkbox", { name: "空间", exact: true }),
  ).not.toBeChecked();
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const left = await panel.boundingBox(),
      right = await page
        .getByRole("region", { name: "提示词列表", exact: true })
        .boundingBox();
    expect(left!.x + left!.width).toBeLessThan(right!.x);
    expect(Math.abs(left!.y - right!.y)).toBeLessThan(2);
  }
});

test("prompt use menu supports hover, complete project search and creating a destination", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  const card = page.locator(".prompt-card").first();
  const prompt = (await (await page.request.get("/api/library/prompts")).json())
    .prompts[0].prompt;
  const use = card.getByRole("button", { name: "使用提示词", exact: true });
  await use.hover();
  const popup = page.locator(".prompt-use-popover:visible");
  await expect(
    popup.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await expect(popup.getByLabel("搜索我的项目", { exact: true })).toHaveCount(
    0,
  );
  await popup.getByRole("button", { name: "搜索项目", exact: true }).click();
  await popup.getByLabel("搜索我的项目", { exact: true }).hover();
  await expect(popup).toBeVisible();
  await popup.getByLabel("搜索我的项目", { exact: true }).fill("不存在的名称");
  await expect(popup.getByText("未找到项目", { exact: true })).toBeVisible();
  await popup.getByRole("button", { name: "搜索项目", exact: true }).click();
  await expect(popup.getByLabel("搜索我的项目", { exact: true })).toHaveCount(
    0,
  );
  await expect(popup.getByText("未找到项目", { exact: true })).toHaveCount(0);
  await popup.getByRole("button", { name: "新建项目", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建项目", exact: true });
  await modal.getByLabel("项目名称", { exact: true }).fill("从提示词新建");
  await modal.getByRole("button", { name: "创建并使用", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "从提示词新建", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    prompt,
  );
});

test("favorite library groups cards and reuses prompts, images and references through project menus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const initialUsage = (
    await (await page.request.get("/api/images/usage")).json()
  ).used;
  const initialFavorites = (
    await (await page.request.get("/api/library/favorites")).json()
  ).favorites.length;
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  for (const name of ["收藏画布目标", "收藏创作目标"])
    expect(
      (
        await page.request.post("/api/projects", { headers, data: { name } })
      ).status(),
    ).toBe(201);
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  const uploaded = await (
    await page.request.post("/api/images/uploads", {
      headers: { ...headers, "Content-Type": "image/png" },
      data: png,
    })
  ).json();
  const assetId = uploaded.id;
  for (const data of [
    { id: randomUUID(), title: "场景图片", groupName: "图片组", assetId },
    {
      id: randomUUID(),
      title: "收藏需求",
      groupName: "提示词组",
      prompt: "完整收藏提示词，不截断。",
    },
    {
      id: randomUUID(),
      title: "默认分组需求",
      groupName: "",
      prompt: "默认分组正文",
    },
  ])
    expect(
      (
        await page.request.post("/api/library/favorites", { headers, data })
      ).status(),
    ).toBe(201);
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "收藏分组",
    exact: true,
  });
  await expect(page.getByLabel("目标项目", { exact: true })).toHaveCount(0);
  await expect(page.locator(".favorite-card")).toHaveCount(
    initialFavorites + 3,
  );
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const left = await panel.boundingBox(),
      right = await page
        .getByRole("region", { name: "收藏列表", exact: true })
        .boundingBox();
    expect(left!.x + left!.width).toBeLessThan(right!.x);
    const visual = page.locator(".favorite-visual").first();
    const visualBox = await visual.boundingBox(),
      imageBox = await visual.getByRole("img").boundingBox();
    expect(imageBox!.height).toBeLessThanOrEqual(visualBox!.height + 1);
    if (width === 1440)
      await page.screenshot({
        path: ".codex-temp/favorite-library-demo.png",
        fullPage: false,
      });
  }

  await panel.getByRole("checkbox", { name: "图片组", exact: true }).check();
  await expect(page.locator(".favorite-card")).toHaveCount(1);
  await panel.getByRole("checkbox", { name: "提示词组", exact: true }).check();
  await expect(page.locator(".favorite-card")).toHaveCount(2);
  await panel.getByRole("checkbox", { name: "图片组", exact: true }).uncheck();
  await expect(page.locator(".favorite-card")).toHaveCount(1);
  const promptCard = page
    .locator(".favorite-card")
    .filter({ hasText: "收藏需求" });
  await promptCard
    .getByRole("button", { name: "使用收藏", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "收藏创作目标", exact: true })
    .click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "完整收藏提示词，不截断。",
  );
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  const imageCard = page
    .locator(".favorite-card")
    .filter({ hasText: "场景图片" });
  await imageCard.getByRole("img", { name: "场景图片", exact: true }).click();
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
  await imageCard
    .getByRole("button", { name: "使用收藏", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "收藏画布目标", exact: true })
    .click();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  await imageCard
    .getByRole("button", { name: "使用收藏", exact: true })
    .click();
  await page
    .locator(".prompt-use-popover:visible")
    .getByText("用作参考", { exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "收藏创作目标", exact: true })
    .click();
  await expect(
    page
      .getByTestId("reference-upload")
      .getByRole("button", { name: "图库参考图", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  await promptCard
    .getByRole("button", { name: "收藏更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "编辑收藏", exact: true }).click();
  await page.getByLabel("收藏标题", { exact: true }).fill("修改后的收藏");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "修改后的收藏", exact: true }),
  ).toBeVisible();
  await page
    .locator(".favorite-card")
    .filter({ hasText: "修改后的收藏" })
    .getByRole("button", { name: "收藏更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "移除收藏", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "修改后的收藏", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/images/usage")).json()).used,
  ).toBe(initialUsage);
  await page.getByRole("button", { name: "新增提示词", exact: true }).click();
  await page.getByLabel("收藏标题", { exact: true }).fill("手动新增需求");
  await page.getByLabel("收藏提示词", { exact: true }).fill("新增收藏正文");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "手动新增需求", exact: true }),
  ).toBeVisible();
});

test("operation feedback is transient, replaces previous messages and leaves form errors in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  const originalTop = (await page
    .getByRole("complementary", { name: "收藏分组", exact: true })
    .boundingBox())!.y;
  await page.getByRole("button", { name: "新增提示词", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "编辑收藏", exact: true });
  await drawer.getByLabel("收藏标题", { exact: true }).fill("反馈测试收藏");
  await drawer
    .getByLabel("收藏提示词", { exact: true })
    .fill("需要保留的完整输入内容");
  await page.route("**/api/library/favorites", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 500,
        json: { error: { code: "INTERNAL_ERROR" } },
      });
    else await route.continue();
  });
  await drawer.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(drawer.getByRole("alert")).toBeVisible();
  await expect(page.locator(".operation-feedback")).toHaveCount(0);
  await expect(drawer.getByLabel("收藏提示词", { exact: true })).toHaveValue(
    "需要保留的完整输入内容",
  );
  await page.unroute("**/api/library/favorites");
  await drawer.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(drawer).toBeHidden();
  const toast = page.locator(".operation-feedback");
  await expect(toast.getByText("已收藏", { exact: true })).toBeVisible();
  expect(
    Math.abs(
      (await page
        .getByRole("complementary", { name: "收藏分组", exact: true })
        .boundingBox())!.y - originalTop,
    ),
  ).toBeLessThan(1);
  await expect(page.locator(".product-notice")).toHaveCount(0);
  await page.screenshot({
    path: ".codex-temp/operation-feedback-success.png",
    fullPage: false,
  });
  const card = page
    .locator(".favorite-card")
    .filter({ hasText: "反馈测试收藏" });
  await page.route("**/api/library/favorites/*/delete", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR" } } }),
  );
  await card.getByRole("button", { name: "收藏更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "移除收藏", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(toast.getByRole("alert")).toBeVisible();
  await expect(toast).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(page.locator(".product-notice")).toHaveCount(0);
  await page.unroute("**/api/library/favorites/*/delete");
  await card.getByRole("button", { name: "收藏更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "移除收藏", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(toast.getByText("已移除", { exact: true })).toBeVisible();
  await expect(toast.getByRole("alert")).toHaveCount(0);
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveCount(0, { timeout: 5000 });
});

test("task recovery shares details and image actions without automatically generating", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: "Task recovery synthetic" },
    })
  ).json();
  const response = await page.request.post("/api/images/tasks", {
    headers,
    data: {
      projectId: project.id,
      requestKey: randomUUID(),
      prompt: "合成任务：保留完整需求",
      model: "test-image",
      count: 1,
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      referenceIds: [],
    },
  });
  expect(response.status()).toBe(202);
  let completed: any;
  await expect
    .poll(async () => {
      const data = await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json();
      completed = data.tasks[0];
      return completed?.state;
    })
    .toBe("succeeded");
  let mode = "failed";
  let dispatched = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/images/tasks"
    )
      dispatched++;
  });
  await page.route("**/api/images/tasks?**", async (route) => {
    const task =
      mode === "failed"
        ? {
            ...completed,
            state: "failed",
            used: 0,
            outputs: [],
            errorCode: "UPSTREAM_RATE_LIMIT",
          }
        : mode === "unknown"
          ? {
              ...completed,
              state: "partial",
              pendingReview: true,
              errorCode: "RESULT_UNKNOWN",
            }
          : completed;
    await route.fulfill({ json: { tasks: [task], hasMore: false } });
  });
  await page.getByRole("link", { name: "额度", exact: true }).click();
  await page
    .getByRole("button", { name: "查看任务详情", exact: true })
    .first()
    .click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await expect(drawer).toContainText("模型服务繁忙");
  await expect(drawer).not.toContainText("UPSTREAM_RATE_LIMIT");
  await drawer.getByRole("button", { name: "复用设置", exact: true }).click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    completed.prompt,
  );
  expect(dispatched).toBe(0);
  await page
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await page
    .getByRole("button", { name: "任务详情", exact: true })
    .first()
    .click();
  await expect(page.locator(".task-tile-details")).toContainText(
    "合成任务：保留完整需求",
  );
  await page.keyboard.press("Escape");
  mode = "unknown";
  await page.getByRole("link", { name: "额度", exact: true }).click();
  await page.getByRole("button", { name: "刷新额度", exact: true }).click();
  await page
    .getByRole("button", { name: "查看任务详情", exact: true })
    .first()
    .click();
  await expect(drawer).toContainText("不要重复生成");
  await expect(
    drawer.getByRole("button", { name: "复用设置", exact: true }),
  ).toHaveCount(0);
  // Already saved images remain useful even when another output needs review.
  await drawer
    .getByRole("button", { name: "更多图片操作", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "预览", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "复用设置", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "作为参考图", exact: true }).click();
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  expect(dispatched).toBe(0);
  mode = "success";
  await page.getByRole("link", { name: "额度", exact: true }).click();
  await page.getByRole("button", { name: "刷新额度", exact: true }).click();
  await page
    .getByRole("button", { name: "查看任务详情", exact: true })
    .first()
    .click();
  await drawer
    .getByRole("button", { name: "更多图片操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "预览", exact: true }).click();
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
  await page.screenshot({ path: ".codex-temp/task-details-unified.png" });
  expect(dispatched).toBe(0);
});

test("custom size expansion reveals both fields in the editor scroll area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await login(page);
  await page.getByLabel("项目名称", { exact: true }).fill("自定义尺寸滚动验收");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "自定义尺寸滚动验收" })
    .click();
  const prompt = page.getByLabel("创作需求", { exact: true });
  await expect(prompt).toBeVisible();
  const before = (await prompt.boundingBox())!.height;
  await page.getByRole("button", { name: "自定义尺寸", exact: true }).click();
  const width = page.getByLabel("宽度", { exact: true }),
    height = page.getByLabel("高度", { exact: true });
  await expect(width).toBeVisible();
  await expect(height).toBeVisible();
  await expect
    .poll(async () =>
      height.evaluate((el) => {
        const scroll = el.closest("fieldset")!;
        const box = el.getBoundingClientRect(),
          bounds = scroll.getBoundingClientRect();
        return box.bottom <= bounds.bottom && box.top >= bounds.top;
      }),
    )
    .toBe(true);
  expect(Math.abs((await prompt.boundingBox())!.height - before)).toBeLessThan(
    1,
  );
  await expect(
    page.getByRole("button", { name: "提交图片任务", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".codex-temp/custom-size-expanded.png" });
  await page.getByRole("button", { name: "自定义尺寸", exact: true }).click();
  await expect(height).toBeHidden();
});

test("style library supports public maintenance and private saved copies without generating", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const originalTasks = await (
    await page.request.get("/api/images/tasks")
  ).json();
  await page.goto("/admin/prompts");
  await page.getByRole("tab", { name: "公共风格", exact: true }).click();
  const manager = page.getByRole("tabpanel", { name: "公共风格", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await manager.getByRole("button", { name: "新增风格", exact: true }).click();
  const publicEditor = page.getByRole("dialog", {
    name: "新增风格",
    exact: true,
  });
  await publicEditor
    .getByLabel("风格名称", { exact: true })
    .fill("公共风格验收");
  await publicEditor
    .getByLabel("风格描述", { exact: true })
    .fill("合成风格：柔和蓝色调");
  await publicEditor
    .getByRole("checkbox", { name: "上架，所有用户可见", exact: true })
    .check();
  await publicEditor
    .getByRole("button", { name: "保存风格", exact: true })
    .click();
  await expect(
    manager.getByRole("row").filter({ hasText: "公共风格验收" }),
  ).toContainText("已上架");
  await expect(publicEditor).toBeHidden();
  await manager
    .getByRole("textbox", { name: "搜索风格", exact: true })
    .fill("不存在的风格");
  await expect(manager.getByText("暂无风格", { exact: true })).toBeVisible();
  await manager
    .getByRole("textbox", { name: "搜索风格", exact: true })
    .fill("");
  await page.getByRole("tab", { name: "提示词", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新增提示词", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "公共风格", exact: true }).click();
  await expect(
    manager.getByRole("row").filter({ hasText: "公共风格验收" }),
  ).toBeVisible();
  await page.screenshot({ path: ".codex-temp/style-management-tabs.png" });

  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("风格库验收");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.locator(".project-card").filter({ hasText: "风格库验收" }).click();
  await page
    .getByLabel("创作需求", { exact: true })
    .fill("独立创作需求保持不变");
  const select = page.getByRole("combobox", { name: "风格", exact: true });
  await select.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("公共风格验收", { exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  const editor = page.locator(".style-editor:visible");
  await editor.getByLabel("风格名称", { exact: true }).fill("我的蓝色风格");
  await editor
    .getByLabel("风格描述", { exact: true })
    .fill("个人修改后的风格描述");
  await editor
    .getByRole("button", { name: "保存为我的风格", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "独立创作需求保持不变",
  );
  const styleData = await (
    await page.request.get("/api/library/styles")
  ).json();
  expect(
    styleData.styles.find((s: any) => s.name === "公共风格验收").text,
  ).toBe("合成风格：柔和蓝色调");
  await page.reload();
  await select.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("我的蓝色风格", { exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(editor.getByLabel("风格描述", { exact: true })).toHaveValue(
    "个人修改后的风格描述",
  );
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  const stylesProjectId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.route("**/api/images/tasks?projectId=*", (route) =>
    route.fulfill({
      json: {
        tasks: [
          {
            id: randomUUID(),
            projectId: stylesProjectId,
            requestKey: randomUUID(),
            state: "failed",
            prompt: "历史任务的独立需求",
            model: "test-image",
            count: 1,
            used: 0,
            held: 0,
            pendingReview: false,
            cancelRequested: false,
            errorCode: "UPSTREAM_RATE_LIMIT",
            createdAt: new Date().toISOString(),
            outputs: [],
            settings: {
              width: 256,
              height: 256,
              quality: "medium",
              format: "png",
              referenceIds: [],
              style: {
                name: "历史任务风格B",
                text: "不属于个人风格A的历史快照",
              },
            },
          },
        ],
      },
    }),
  );
  await expect(
    page.getByRole("button", { name: "任务与结果 · 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "任务与结果 · 1", exact: true })
    .click();
  await page.getByRole("button", { name: "任务详情", exact: true }).click();
  await page
    .locator(".task-tile-details")
    .getByRole("button", { name: "复用设置", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  await editor
    .getByRole("button", { name: "保存为我的风格", exact: true })
    .click();
  await expect(editor).toBeHidden();
  const preserved = (
    await (await page.request.get("/api/library/styles")).json()
  ).styles.find((s: any) => s.name === "我的蓝色风格");
  expect(preserved.text).toBe("个人修改后的风格描述");
  await page.unroute("**/api/images/tasks?projectId=*");
  await select.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("我的蓝色风格", { exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await editor
    .getByLabel("风格描述", { exact: true })
    .fill("保存失败也保留的编辑内容");
  await page.route("**/api/library/styles", async (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          json: { error: { code: "STYLE_CONFLICT" } },
        })
      : route.continue(),
  );
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(editor.getByLabel("风格描述", { exact: true })).toHaveValue(
    "保存失败也保留的编辑内容",
  );
  await page.unroute("**/api/library/styles");
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await editor.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await select.click();
  await expect(
    page
      .locator(".ant-select-dropdown:visible")
      .getByText("我的蓝色风格", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const tasks = await (await page.request.get("/api/images/tasks")).json();
  expect(tasks.tasks).toHaveLength(originalTasks.tasks.length);
  await page.screenshot({ path: ".codex-temp/style-library.png" });
});

test("prompt shortcuts prefer text favorites and browse in place without changing style or references", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  for (;;) {
    const current = await (
      await page.request.get("/api/library/favorites")
    ).json();
    if (!current.favorites.length) break;
    for (const item of current.favorites)
      await page.request.post(`/api/library/favorites/${item.id}/delete`, {
        headers,
        data: {},
      });
  }
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: "提示词快捷验收" },
    })
  ).json();
  await page.goto(`/projects/${project.id}`);
  const shortcuts = page.getByRole("group", {
    name: "快捷提示词",
    exact: true,
  });
  await expect(shortcuts.getByRole("button")).toHaveCount(4);
  await expect(
    shortcuts.getByRole("button", { name: "简洁商品展示", exact: true }),
  ).toBeVisible();
  const more = shortcuts.getByRole("button", {
    name: "更多提示词",
    exact: true,
  });
  await more.click();
  const picker = page.locator(".prompt-picker:visible");
  await expect(
    picker.getByRole("tab", { name: "公共提示词", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(36);
  const longItem = picker
    .locator(".prompt-picker-item")
    .filter({ hasText: "电商白底主图" });
  await longItem.getByText("展开", { exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue("");
  await longItem.getByText("收起", { exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue("");

  await expect(picker.locator(".prompt-picker-item").first()).toContainText(
    "品牌宣传构图",
  );
  await picker
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill("电商白底主图");
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(1);
  await expect(picker.locator(".prompt-picker-item")).toContainText(
    "电商白底主图",
  );
  await picker.getByRole("tab", { name: "我的收藏", exact: true }).click();
  await expect(
    picker.getByText("还没有收藏提示词", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  for (let n = 1; n <= 5; n++)
    expect(
      (
        await page.request.post("/api/library/favorites", {
          headers,
          data: {
            id: randomUUID(),
            title: `收藏提示${n}`,
            groupName: n === 1 ? "A组" : "B组",
            prompt: `完整收藏正文${n}`,
          },
        })
      ).status(),
    ).toBe(201);
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  const asset = await (
    await page.request.post("/api/images/uploads", {
      headers: { ...headers, "Content-Type": "image/png" },
      data: png,
    })
  ).json();
  expect(
    (
      await page.request.post("/api/library/favorites", {
        headers,
        data: {
          id: randomUUID(),
          title: "不应出现的图片收藏",
          groupName: "仅图片",
          assetId: asset.id,
        },
      })
    ).status(),
  ).toBe(201);
  await page.reload();
  await expect(shortcuts.getByRole("button")).toHaveCount(4);
  await expect(shortcuts).not.toContainText("不应出现的图片收藏");
  await expect(shortcuts).not.toContainText("简洁商品展示");
  await expect(
    shortcuts.getByRole("button", { name: "收藏提示5", exact: true }),
  ).toBeVisible();
  await page.getByLabel("创作需求", { exact: true }).fill("已有的独立需求");
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("真实摄影", { exact: true })
    .click();
  await page
    .getByTestId("reference-upload")
    .locator('input[type="file"]')
    .setInputFiles({ name: "参考.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  await more.click();
  await expect(
    picker.getByRole("tab", { name: "我的收藏", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await picker
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill("正文1");
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(1);
  await picker.getByRole("combobox", { name: "收藏分组", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("B组", { exact: true })
    .click();
  await expect(
    picker.getByText("没有匹配的提示词", { exact: true }),
  ).toBeVisible();
  await picker.getByRole("combobox", { name: "收藏分组", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("A组", { exact: true })
    .click();
  await picker.locator(".prompt-picker-item .content-excerpt").click();
  const confirm = page.getByRole("dialog", { name: "请确认", exact: true });
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "已有的独立需求",
  );
  await expect(picker).toBeVisible();
  await picker
    .locator(".prompt-picker-item")
    .click({ position: { x: 3, y: 3 } });
  await confirm.getByRole("button", { name: "确认", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "完整收藏正文1",
  );
  await expect(
    page.getByRole("combobox", { name: "风格", exact: true }).locator(".."),
  ).toContainText("真实摄影");
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
  await more.click();
  await picker
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill("正文");
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(5);
  await page.screenshot({ path: ".codex-temp/prompt-shortcuts.png" });
  await page.keyboard.press("Escape");
  for (let n = 6; n <= 56; n++)
    await page.request.post("/api/library/favorites", {
      headers,
      data: {
        id: randomUUID(),
        title: `分页收藏${n}`,
        groupName: "分页",
        prompt: `分页正文${n}`,
      },
    });
  await more.click();
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(50);
  await picker.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(56);
  await page.keyboard.press("Escape");
  await page.goto("/admin/prompts");
  const row = page.getByRole("row").filter({ hasText: "简洁商品展示" });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑提示词", exact: true });
  await expect(
    editor.getByRole("checkbox", { name: "优先展示", exact: true }),
  ).toBeChecked();
  await editor
    .getByRole("checkbox", { name: "优先展示", exact: true })
    .uncheck();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeHidden();
  const recommended = await (
    await page.request.get("/api/library/prompt-picker?source=recommended")
  ).json();
  expect(recommended.items).toHaveLength(36);
  expect(
    recommended.items.findIndex((p: any) => p.id === "product-studio"),
  ).toBeGreaterThanOrEqual(2);
});

test("prompt bookmarks connect public browsing, private editing and protected creation drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const suffix = randomUUID().slice(0, 8),
    title = `链路提示${suffix}`,
    body = `完整链路正文 ${suffix}`;
  const source = await page.request.post("/api/admin/prompts", {
    headers,
    data: {
      id: `flow-${suffix}`,
      title,
      category: "链路",
      prompt: body,
      published: true,
      revision: 0,
    },
  });
  expect(source.status()).toBe(201);
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: `草稿保护${suffix}` },
    })
  ).json();
  await page.goto(`/projects/${project.id}`);
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("当前未提交草稿");
  await page.getByLabel("风格", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("海报视觉", { exact: true })
    .click();
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill(suffix);
  const card = page.locator(".prompt-card").filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "收藏提示词", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "已收藏提示词", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("dialog", { name: "编辑收藏", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "使用提示词", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: project.name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: project.name, exact: true })
    .press("Enter");
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .press("Escape");
  await expect(page).toHaveURL(/\/prompts$/);
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.locator(".project-card").filter({ hasText: project.name }).click();
  await expect(prompt).toHaveValue("当前未提交草稿");
  await expect(
    page.getByLabel("风格", { exact: true }).locator(".."),
  ).toContainText("海报视觉");
  await page.getByRole("button", { name: "更多提示词", exact: true }).click();
  const picker = page.locator(".prompt-picker:visible");
  await picker
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill(suffix);
  await expect(picker.locator(".prompt-picker-item")).toHaveCount(1);
  await picker.locator(".content-excerpt").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(prompt).toHaveValue(body);
  await prompt.fill(`自定义收藏正文 ${suffix}`);
  await page.getByRole("button", { name: "收藏提示词", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "收藏提示词", exact: true });
  await dialog.getByLabel("标题", { exact: true }).fill(`我的版本${suffix}`);
  await dialog.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "更多提示词", exact: true }).click();
  await expect(
    picker.getByRole("button", { name: `选用 我的版本${suffix}`, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "收藏", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill(suffix);
  await expect(page.locator(".favorite-prompt-card")).toHaveCount(2);
  const personal = page
    .locator(".favorite-prompt-card")
    .filter({ hasText: `我的版本${suffix}` });
  await personal
    .getByRole("button", { name: "收藏更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "编辑收藏", exact: true }).click();
  await page.getByLabel("收藏分组名称", { exact: true }).fill("链路");
  await page.getByRole("button", { name: "保存收藏", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "编辑收藏", exact: true }),
  ).toBeHidden();
  await expect(personal).toContainText("链路");
  const submitted = await page.request.post("/api/images/tasks", {
    headers,
    data: {
      projectId: project.id,
      requestKey: randomUUID(),
      prompt: `历史任务${suffix}`,
      model: "test-image",
      count: 1,
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      referenceIds: [],
    },
  });
  expect(submitted.status()).toBe(202);
  await page.getByRole("link", { name: "额度", exact: true }).click();
  await page
    .getByRole("region", { name: "使用记录", exact: true })
    .getByRole("button", { name: "查看任务详情", exact: true })
    .first()
    .click();
  const taskDetails = page.getByRole("dialog", {
    name: "任务详情",
    exact: true,
  });
  await expect(taskDetails).toContainText(`历史任务${suffix}`);
  await taskDetails
    .getByRole("button", { name: "复用设置", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page).toHaveURL(/\/usage$/);
  await taskDetails
    .getByRole("button", { name: "复用设置", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));
  await expect(prompt).toHaveValue(`历史任务${suffix}`);
});

test("server drafts persist direct and Agent inputs across refresh and login and protect concurrent edits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const project = await (
    await page.request.post("/api/projects", {
      headers,
      data: { name: `服务端草稿 ${randomUUID().slice(0, 8)}` },
    })
  ).json();
  const url = `/projects/${project.id}`;
  await page.goto(url);
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("刷新后应恢复的创作需求");
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("真实摄影", { exact: true })
    .click();
  await page.getByRole("combobox", { name: "图片张数", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  await page
    .getByTestId("reference-upload")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "草稿参考.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  await selectCreationPanel(page, "agent");
  const agent = page.getByLabel("告诉 Agent 你的想法", { exact: true });
  await agent.fill("独立保留的 Agent 想法");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document,
    )
    .toMatchObject({
      direct: {
        prompt: "刷新后应恢复的创作需求",
        settings: { count: 2 },
        style: { name: "真实摄影" },
      },
      agent: { prompt: "独立保留的 Agent 想法" },
      mode: "agent",
    });
  const saved = await (
    await page.request.get(`/api/projects/${project.id}/draft`)
  ).json();
  expect(saved.document.referenceIds).toHaveLength(1);
  await page.reload();
  await expect(agent).toHaveValue("独立保留的 Agent 想法");
  await expect(
    page.getByRole("button", { name: "Agent 面板", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await selectCreationPanel(page, "direct");
  await expect(prompt).toHaveValue("刷新后应恢复的创作需求");
  await expect(
    page.getByRole("combobox", { name: "风格", exact: true }).locator(".."),
  ).toContainText("真实摄影");
  await expect(
    page.getByRole("combobox", { name: "图片张数", exact: true }).locator(".."),
  ).toContainText("2 张");
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await logoutFromMenu(page);
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await login(page);
  await page.goto(url);
  await expect(prompt).toHaveValue("刷新后应恢复的创作需求");
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  const second = await page.context().newPage();
  await second.goto(url);
  const otherPrompt = second.getByLabel("创作需求", { exact: true });
  await expect(otherPrompt).toHaveValue("刷新后应恢复的创作需求");
  await prompt.fill("另一个标签页已保存");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document.direct.prompt,
    )
    .toBe("另一个标签页已保存");
  await otherPrompt.fill("冲突时必须保留的本地输入");
  await expect(
    second.getByText("草稿未保存：草稿已在其他页面更新，当前输入已保留。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(otherPrompt).toHaveValue("冲突时必须保留的本地输入");
  let releaseReload!: () => void, reloadStarted!: () => void;
  const reloadGate = new Promise<void>((resolve) => (releaseReload = resolve)),
    reloadRequest = new Promise<void>((resolve) => (reloadStarted = resolve));
  await second.route(
    `**/api/projects/${project.id}/draft`,
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      reloadStarted();
      await reloadGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await second
    .getByRole("button", { name: "加载最新草稿", exact: true })
    .click();
  await second
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await reloadRequest;
  await otherPrompt.fill("在加载期间新输入的内容");
  releaseReload();
  await expect(
    second.getByText(/加载期间内容已修改，当前输入已保留/),
  ).toBeVisible();
  await expect(otherPrompt).toHaveValue("在加载期间新输入的内容");
  await second.unroute(`**/api/projects/${project.id}/draft`);
  await second
    .getByRole("button", { name: "加载最新草稿", exact: true })
    .click();
  await second
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(otherPrompt).toHaveValue("另一个标签页已保存");
  await prompt.fill("再次更新的服务器草稿");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document.direct.prompt,
    )
    .toBe("再次更新的服务器草稿");
  await otherPrompt.fill("明确选择保留的版本");
  await expect(
    second.getByRole("button", { name: "保留当前版本", exact: true }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "保留当前版本", exact: true })
    .click();
  await second
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document.direct.prompt,
    )
    .toBe("明确选择保留的版本");
  await expect(otherPrompt).toHaveValue("明确选择保留的版本");
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
  await second.close();
  // A failed save must leave the input intact and prevent route loss until retried.
  await page.reload();
  await expect(prompt).toHaveValue("明确选择保留的版本");
  await page.route(`**/api/projects/${project.id}/draft`, (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await prompt.fill("网络失败后仍要保留的输入");
  await expect(page.getByText(/草稿未保存：无法连接服务/)).toBeVisible();
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));
  await expect(prompt).toHaveValue("网络失败后仍要保留的输入");
  await expect(
    page.getByText(/^未能保存当前修改，已留在当前页面/),
  ).toBeVisible();
  await page.unroute(`**/api/projects/${project.id}/draft`);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document.direct.prompt,
    )
    .toBe("网络失败后仍要保留的输入");
  await page.reload();
  await expect(prompt).toHaveValue("网络失败后仍要保留的输入");
});

test("task reuse confirms changes to saved generation parameters even when text is identical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json(),
    headers = {
      Origin: "http://127.0.0.1:5180",
      "X-CSRF-Token": session.csrfToken,
    };
  const name = `参数保护 ${randomUUID().slice(0, 8)}`,
    text = `相同需求 ${randomUUID().slice(0, 8)}`;
  const project = await (
    await page.request.post("/api/projects", { headers, data: { name } })
  ).json();
  const response = await page.request.post("/api/images/tasks", {
    headers,
    data: {
      projectId: project.id,
      requestKey: randomUUID(),
      prompt: text,
      model: "test-image",
      width: 1024,
      height: 1024,
      count: 1,
      quality: "medium",
      format: "png",
      referenceIds: [],
    },
  });
  expect(response.status()).toBe(202);
  await page.goto(`/projects/${project.id}`);
  await page.getByLabel("创作需求", { exact: true }).fill(text);
  const count = page.getByRole("combobox", { name: "图片张数", exact: true });
  await count.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document.direct,
    )
    .toMatchObject({
      prompt: text,
      settings: {
        modelKey: "test-image",
        width: 1024,
        height: 1024,
        quality: "medium",
        format: "png",
        count: 2,
      },
    });
  await page.getByRole("link", { name: "额度", exact: true }).click();
  await page
    .getByRole("region", { name: "使用记录", exact: true })
    .getByRole("button", { name: "查看任务详情", exact: true })
    .first()
    .click();
  const details = page.getByRole("dialog", { name: "任务详情", exact: true });
  await expect(details).toContainText(text);
  await details.getByRole("button", { name: "复用设置", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "请确认",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.press("Escape");
  await expect(page).toHaveURL(/\/usage$/);
  expect(
    (await (await page.request.get(`/api/projects/${project.id}/draft`)).json())
      .document.direct.settings.count,
  ).toBe(2);
  await details.getByRole("button", { name: "复用设置", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(text);
  await expect(count.locator("..")).toContainText("1 张");
  await page.getByLabel("创作需求", { exact: true }).fill("");
  await count.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${project.id}/draft`)
          ).json()
        ).document.direct,
    )
    .toMatchObject({ prompt: "", settings: { count: 2 } });
  await page
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await page
    .getByRole("button", { name: "任务详情", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "复用设置", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.press("Escape");
  await expect(count.locator("..")).toContainText("2 张");
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue("");
});

test("Agent clarification stays conversational and proposals separate creative and technical details", async ({
  page,
}) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const project = await (
    await page.request.post("/api/projects", {
      headers: {
        Origin: "http://127.0.0.1:5180",
        "X-CSRF-Token": session.csrfToken,
      },
      data: { name: "澄清与方案验收" },
    })
  ).json();
  const jobs: any[] = [];
  const inputs: any[] = [];
  let completeFirstReply = () => {};
  let failNextRevision = false,
    passwordPosts = 0;
  await page.route("**/api/auth/password", async (route) => {
    passwordPosts++;
    await route.fulfill({
      status: 400,
      json: { error: { code: "BAD_INPUT" } },
    });
  });
  async function attemptPasswordChange() {
    await page.getByRole("button", { name: "账户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "修改密码", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "修改密码", exact: true });
    await dialog.getByLabel("当前密码", { exact: true }).fill(auth.password);
    await dialog
      .getByLabel("新密码", { exact: true })
      .fill("Synthetic-blocked-password-2026!");
    await dialog
      .getByLabel("确认新密码", { exact: true })
      .fill("Synthetic-blocked-password-2026!");
    await dialog
      .getByRole("button", { name: "保存并重新登录", exact: true })
      .click();
    return dialog;
  }

  await page.route("**/api/agent/jobs?**", (route) =>
    route.fulfill({ json: { jobs } }),
  );
  await page.route("**/api/agent/planning", async (route) => {
    const input = route.request().postDataJSON();
    inputs.push(input);
    const job = {
      id: randomUUID(),
      projectId: project.id,
      requestKey: input.requestKey,
      prompt: input.prompt,
      state: "succeeded",
      charged: true,
      errorCode: null,
      createdAt: new Date().toISOString(),
      plans: [
        {
          id: randomUUID(),
          jobId: "",
          version: 1,
          confirmed: false,
          taskIds: [],
          document: {
            message:
              inputs.length === 1
                ? "用于朋友圈还是店内张贴？也可以先按当前方形规格看暖色视觉草稿。"
                : "奶油暖色搭配咖啡杯主体，上方放开业标题，底部预留店名、日期与地址，不编造信息。",
            steps:
              inputs.length === 1
                ? []
                : [
                    {
                      title: "咖啡店开业海报",
                      prompt: "暖色咖啡杯主体，开业标题，底部留白",
                      model: input.model,
                      modelSelectionId: input.modelSelectionId,
                      width: input.width,
                      height: input.height,
                      quality: input.quality,
                      format: input.format,
                      count: 1,
                      referenceIds: [],
                      tool: { id: "image.generate", version: 1 },
                      usePrevious: false,
                    },
                  ],
          },
        },
      ],
    };
    job.plans[0].jobId = job.id;
    if (inputs.length === 1) {
      const reply = job.plans;
      job.state = "running";
      job.plans = [];
      completeFirstReply = () => {
        job.state = "succeeded";
        job.plans = reply;
      };
    }
    jobs.unshift(job);
    await route.fulfill({ status: 202, json: job });
  });
  await page.route("**/api/agent/jobs/*/revisions", async (route) => {
    if (failNextRevision) {
      failNextRevision = false;
      await route.abort("failed");
      return;
    }

    const job = jobs[0],
      last = job.plans.at(-1);
    const saved = {
      ...last,
      id: randomUUID(),
      version: last.version + 1,
      document: route.request().postDataJSON().document,
    };
    job.plans.push(saved);
    await route.fulfill({ json: saved });
  });
  await page.goto(`/projects/${project.id}`);
  await selectCreationPanel(page, "agent");
  const prompt = page.getByLabel("告诉 Agent 你的想法", { exact: true });
  await prompt.fill("设计咖啡店开业海报");
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "正在规划…", exact: true }),
  ).toBeDisabled();
  expect(inputs).toHaveLength(1);
  await expect(prompt).toBeEnabled();
  completeFirstReply();

  await expect(
    page.getByText(
      "用于朋友圈还是店内张贴？也可以先按当前方形规格看暖色视觉草稿。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(prompt).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认执行", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".agent-plan-form")).toHaveCount(0);
  await prompt.fill("先按当前规格看草稿，店名和日期留空");
  await page.getByRole("button", { name: "发送回答", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认执行", exact: true }),
  ).toBeVisible();
  expect(inputs[1].previousPlanId).toBe(jobs[1].plans[0].id);
  await expect(
    page.getByRole("button", { name: "查看方案", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".agent-proposal-description")).toContainText(
    "底部预留店名",
  );
  await expect(page.getByLabel("步骤 1 提示词", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "步骤 1 格式", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "调整方案", exact: true }).click();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue("先按当前规格看草稿，店名和日期留空");
  await prompt.fill("保留布局，换成更年轻的配色");
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "步骤 1 张数", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "继续聊想法", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "调整方案", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "更新方案", exact: true }),
  ).toBeDisabled();
  expect(inputs).toHaveLength(2);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.getByRole("link", { name: "图库", exact: true }).click();
  const leaveDialog = page.getByRole("dialog", { name: "请确认", exact: true });
  await expect(leaveDialog).toContainText("方案修改尚未保存");
  await leaveDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));
  await expect(
    page.getByRole("button", { name: "保存计划修改", exact: true }),
  ).toBeVisible();

  const passwordDialog = await attemptPasswordChange();
  const discardForPassword = page.getByRole("dialog", {
    name: "请确认",
    exact: true,
  });
  await expect(discardForPassword).toContainText("方案修改尚未保存");
  await discardForPassword
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(passwordDialog).toContainText("请先处理当前页面");
  expect(passwordPosts).toBe(0);
  await passwordDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  failNextRevision = true;
  await page.getByRole("button", { name: "保存计划修改", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "重试保存本次修改", exact: true }),
  ).toBeVisible();
  const unknownPasswordDialog = await attemptPasswordChange();
  await expect(unknownPasswordDialog).toContainText("请先处理当前页面");
  await expect(
    page.getByRole("dialog", { name: "请确认", exact: true }),
  ).toHaveCount(0);
  expect(passwordPosts).toBe(0);
  await unknownPasswordDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page
    .getByRole("button", { name: "重试保存本次修改", exact: true })
    .click();
  await page.getByRole("button", { name: "调整方案", exact: true }).click();
  await expect(prompt).toHaveValue("保留布局，换成更年轻的配色");

  await page.getByRole("button", { name: "更新方案", exact: true }).click();
  await expect.poll(() => inputs.length).toBe(3);
  expect(inputs[2].previousPlanId).toBe(jobs[1].plans.at(-1).id);
  jobs[0].plans[0].confirmed = true;
  await page.reload();
  await selectCreationPanel(page, "agent");
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "步骤 1 张数", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "步骤 1 图片设置", exact: true })
    .click();
  await page.getByRole("button", { name: "查看提示词", exact: true }).click();
  await expect(
    page.getByLabel("步骤 1 提示词", { exact: true }),
  ).toBeDisabled();
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${project.id}`)
      ).json()
    ).tasks,
  ).toEqual([]);
});

test("shared creation controls respect parent locks and dismiss helpers across modes", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("项目名称", { exact: true }).fill("共享创作控件验收");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name: /共享创作控件验收 .*创建/ }).click();
  const quota = page.locator("header .header-usage");
  await quota.click();
  const billingHelp = page.getByRole("button", {
    name: "额度与计费说明",
    exact: true,
  });
  await billingHelp.click();
  await expect(page.locator(".help-content:visible")).toContainText(
    "次数额度不代表账单上限",
  );
  await expect(
    page.locator(".help-popover:visible .ant-popover-container"),
  ).toHaveCSS("border-radius", "10px");
  await page.locator(".help-content:visible").press("Escape");
  await expect(billingHelp).toBeFocused();
  await expect(quota).toHaveAttribute("aria-expanded", "true");
  await quota.click();
  await expect(page.locator(".help-content:visible")).toHaveCount(0);
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("共享控件测试：暖色咖啡店海报");
  const style = page.getByRole("combobox", { name: "风格", exact: true });
  await style.click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("真实摄影", { exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await page.getByLabel("风格描述", { exact: true }).fill("尚未应用的临时编辑");
  await selectCreationPanel(page, "agent");
  await expect(page.locator(".style-editor:visible")).toHaveCount(0);
  const agentHelp = page.getByRole("button", {
    name: "规划与执行规则",
    exact: true,
  });
  await agentHelp.click();
  const content = page.locator(".help-content:visible");
  await content.press("Escape");
  await expect(agentHelp).toBeFocused();
  await agentHelp.click();
  await selectCreationPanel(page, "direct");
  await expect(page.locator(".help-content:visible")).toHaveCount(0);
  await expect(prompt).toHaveValue("共享控件测试：暖色咖啡店海报");
  const directHelp = page.getByRole("button", {
    name: "生成说明",
    exact: true,
  });
  await directHelp.click();
  await page.locator(".help-content:visible").press("Escape");
  await expect(directHelp).toBeFocused();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/images/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await gate;
    await route.fulfill({
      status: 429,
      json: { error: { code: "SUBMISSION_RATE" } },
    });
  });
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  await expect(style).toBeDisabled();
  await expect(page.locator(".style-selector .ant-select")).toHaveClass(
    /ant-select-disabled/,
  );
  await expect(
    page.getByRole("button", { name: "收藏提示词", exact: true }),
  ).toHaveAttribute("disabled", "");
  await expect(page.locator(".prompt-shortcut").first()).toHaveAttribute(
    "disabled",
    "",
  );

  await expect(
    page.getByRole("button", { name: "收藏提示词", exact: true }),
  ).toBeDisabled();
  release();
  await expect(style).toBeEnabled();
  await expect(prompt).toHaveValue("共享控件测试：暖色咖啡店海报");
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(page.getByLabel("风格描述", { exact: true })).not.toHaveValue(
    "尚未应用的临时编辑",
  );
  await page
    .locator(".style-editor")
    .getByRole("button", { name: "取消", exact: true })
    .click();
});

test("canvas keyboard shortcuts stay scoped and persist grouped node copies", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("快捷键合成验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "快捷键合成验证" })
    .click();
  await page.getByLabel("创作需求", { exact: true }).fill("快捷键测试图片");
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  const images = page.locator(".react-flow__node-image");
  await expect(images).toHaveCount(1, { timeout: 20000 });
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  for (const mod of ["Control", "Meta"]) {
    await canvas.focus();
    await page.keyboard.press(`${mod}+a`);
    await expect(images.first()).toHaveClass(/selected/);
    await page.keyboard.press(`${mod}+c`);
    await expect(images).toHaveCount(1);
    await page.keyboard.press(`${mod}+v`);
    await expect(images).toHaveCount(2);
    await expect(images.nth(1)).toHaveClass(/selected/);
    await page.keyboard.press(`${mod}+z`);
    await expect(images).toHaveCount(1);
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect(images).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press("Backspace");
    await expect(images).toHaveCount(0);
    await page.keyboard.press(`${mod}+z`);
    await expect(images).toHaveCount(2);
    await page.keyboard.press(`${mod}+z`);
    await expect(images).toHaveCount(1);
  }
  // Pointer focus works without programmatically focusing the canvas.
  await images.first().click({ position: { x: 40, y: 50 } });
  await page.keyboard.down("Control");
  await page.keyboard.down("d");
  await page.keyboard.down("d");
  await page.keyboard.up("d");
  await page.keyboard.up("Control");
  await expect(images).toHaveCount(2);
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "分组", exact: true }).click();
  const groups = page.locator(".react-flow__node-group");
  await expect(groups).toHaveCount(1);
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(groups).toHaveCount(2);
  await expect(images).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(groups).toHaveCount(1);
  await expect(images).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(images).toHaveCount(4);
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("输入框应保留原生行为");
  const nativeModifier = process.platform === "darwin" ? "Meta" : "Control";
  await prompt.press(`${nativeModifier}+a`);
  await prompt.press("Backspace");
  await expect(prompt).toHaveValue("");
  await prompt.press(`${nativeModifier}+v`);
  await expect(images).toHaveCount(4);
  // A portal preview must not pass canvas shortcuts through its React ancestry.
  await images.last().dblclick({ position: { x: 30, y: 50 } });
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(images).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const projectId = page.url().split("/").at(-1)!;
  const saved = await (
    await page.request.get(`/api/projects/${projectId}/canvas`)
  ).json();
  expect(saved.document.nodes).toHaveLength(6);
  expect(new Set(saved.document.nodes.map((n: any) => n.id)).size).toBe(6);
  expect(
    new Set(
      saved.document.nodes
        .filter((n: any) => n.kind === "image")
        .map((n: any) => n.assetId),
    ).size,
  ).toBe(1);
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(1);
  await page.reload();
  await expect(images).toHaveCount(4);
  await canvas.focus();
  await page.keyboard.press("Control+v");
  await expect(images).toHaveCount(4);
  const wrongOrigin = await page.request.post("/api/auth/login", {
    headers: { Origin: "http://127.0.0.1:8793" },
    data: {},
  });
  expect((await wrongOrigin.json()).error.code).toBe("INVALID_ORIGIN");
});

test("canvas uploads and reference uploads share private assets without generation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("上传图片到画布验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "上传图片到画布验证" })
    .click();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await expect(canvas).toBeVisible();
  const usageBefore = await (
    await page.request.get("/api/images/usage")
  ).json();
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 400, height: 200, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  const file = (name: string) => ({ name, mimeType: "image/png", buffer: png });
  const nodes = page.locator(".react-flow__node-image");
  const directRefs = page.getByTestId("reference-upload");
  await canvas
    .locator('input[type="file"]')
    .setInputFiles(file("画布素材.png"));
  await expect(nodes).toHaveCount(1);
  await expect(nodes.first().getByRole("img")).toHaveAttribute(
    "alt",
    "画布素材.png",
  );
  await expect(directRefs.locator(".attachment")).toHaveCount(0);
  await directRefs
    .getByRole("button", { name: "引用选中 1 张", exact: true })
    .click();
  await expect(directRefs.locator(".attachment")).toHaveCount(1);
  await expect(
    directRefs.getByRole("button", { name: "引用选中 1 张", exact: true }),
  ).toBeDisabled();
  await directRefs
    .locator('input[type="file"]')
    .setInputFiles(file("参考素材.png"));
  await expect(nodes).toHaveCount(2);
  await expect(directRefs.locator(".attachment")).toHaveCount(2);
  await selectCreationPanel(page, "agent");
  const agentRefs = page.getByTestId("agent-reference-upload");
  await agentRefs
    .locator('input[type="file"]')
    .setInputFiles(file("Agent参考.png"));
  await expect(nodes).toHaveCount(3);
  await expect(agentRefs.locator(".attachment")).toHaveCount(3);
  await selectCreationPanel(page, "direct");
  await directRefs
    .locator('input[type="file"]')
    .setInputFiles(file("第四张.png"));
  await expect(nodes).toHaveCount(4);
  await expect(
    directRefs.getByRole("button", { name: "上传参考图", exact: true }),
  ).toBeDisabled();
  await canvas.locator('input[type="file"]').setInputFiles(file("仅画布.png"));
  await expect(nodes).toHaveCount(5);
  await expect(directRefs.locator(".attachment")).toHaveCount(4);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const projectId = page.url().split("/").at(-1)!;
  const saved = await (
    await page.request.get(`/api/projects/${projectId}/canvas`)
  ).json();
  expect(saved.document.nodes).toHaveLength(5);
  expect(saved.document.nodes.every((n: any) => n.width / n.height === 2)).toBe(
    true,
  );
  const assets = saved.document.nodes.map((n: any) => n.assetId);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${projectId}/draft`)
          ).json()
        ).document.referenceIds.length,
    )
    .toBe(4);
  const draft = await (
    await page.request.get(`/api/projects/${projectId}/draft`)
  ).json();
  expect(
    draft.document.referenceIds.every((id: string) => assets.includes(id)),
  ).toBe(true);
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
  const usageAfter = await (await page.request.get("/api/images/usage")).json();
  expect(usageAfter.used).toBe(usageBefore.used);
  expect(usageAfter.attempts).toBe(usageBefore.attempts);
  expect(usageAfter.storageUsed).toBeGreaterThan(usageBefore.storageUsed);
  await page.reload();
  await expect(nodes).toHaveCount(5);
  await expect(directRefs.locator(".attachment")).toHaveCount(4);
  const session = await (await page.request.get("/api/auth/me")).json();
  const deletion = await page.request.post(
    `/api/images/assets/${assets[4]}/delete`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": session.csrfToken,
      },
      data: {},
    },
  );
  expect((await deletion.json()).error.code).toBe("ASSET_REFERENCED");
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(nodes).toHaveCount(0);
  await expect(directRefs.locator(".attachment")).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(nodes).toHaveCount(5);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
});

test("late canvas upload responses cannot write into another project and invalid images stay rejected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  for (const name of ["上传晚响应目标", "上传晚响应来源"]) {
    await page.getByLabel("项目名称").fill(name);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(
      page.locator(".project-card").filter({ hasText: name }),
    ).toBeVisible();
  }
  await page
    .locator(".project-card")
    .filter({ hasText: "上传晚响应来源" })
    .click();
  const sourceUrl = page.url();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await expect(canvas).toBeVisible();
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 64, height: 64, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  let accepted!: () => void,
    release!: () => void,
    count = 0,
    assetId = "";
  const uploaded = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/images/uploads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    count++;
    const response = await route.fetch();
    assetId = (await response.json()).id;
    accepted();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await canvas
    .locator('input[type="file"]')
    .setInputFiles({ name: "晚到.png", mimeType: "image/png", buffer: png });
  await uploaded;
  await page.getByRole("link", { name: "上传晚响应目标", exact: true }).click();
  await expect(page).not.toHaveURL(sourceUrl);
  await expect(canvas).toBeVisible();
  release();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "上传晚响应来源", exact: true }).click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(canvas).toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
  const uploads = await (await page.request.get("/api/images/uploads")).json();
  expect(uploads.assets.some((asset: any) => asset.id === assetId)).toBe(true);
  expect(count).toBe(1);
  await page.unroute("**/api/images/uploads");
  await selectCreationPanel(page, "agent");
  await canvas.locator('input[type="file"]').setInputFiles({
    name: "伪造.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(
    page.getByText("图片格式、大小或解码检查未通过。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
  let unknownCalls = 0,
    unknownAssetId = "";
  await page.route("**/api/images/uploads", async (route) => {
    unknownCalls++;
    const response = await route.fetch();
    unknownAssetId = (await response.json()).id;
    await route.abort("failed");
  });
  await canvas.locator('input[type="file"]').setInputFiles({
    name: "响应丢失.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByText("上传结果未确认，请先到图库查看，避免重复上传。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
  expect(unknownCalls).toBe(1);
  await page.unroute("**/api/images/uploads");
  const recovered = await (
    await page.request.get("/api/images/uploads")
  ).json();
  expect(
    recovered.assets.some((asset: any) => asset.id === unknownAssetId),
  ).toBe(true);
});

test("canvas accepts local image drops and native screenshot paste without intercepting text editing", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("拖放与截图验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "拖放与截图验证" })
    .click();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await expect(canvas).toBeVisible();
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 320, height: 160, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  const b64 = png.toString("base64");
  const transfer = await page.evaluateHandle((encoded) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
        "拖入.png",
        { type: "image/png" },
      ),
    );
    return data;
  }, b64);
  await canvas.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(
    page.getByText("松开以将图片上传到画布（每批最多20张）", { exact: true }),
  ).toBeVisible();
  await canvas.dispatchEvent("dragover", { dataTransfer: transfer });
  await canvas.dispatchEvent("drop", { dataTransfer: transfer });
  const images = page.locator(".react-flow__node-image");
  await expect(images).toHaveCount(1);
  await expect(images.first().getByRole("img")).toHaveAttribute(
    "alt",
    "拖入.png",
  );
  await expect(
    canvas.getByRole("button", { name: "上传图片到画布", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(0);
  const multiple = await page.evaluateHandle((encoded) => {
    const data = new DataTransfer();
    for (const name of Array.from({ length: 21 }, (_, i) => `${i}.png`))
      data.items.add(
        new File(
          [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
          name,
          { type: "image/png" },
        ),
      );
    return data;
  }, b64);
  await canvas.dispatchEvent("drop", { dataTransfer: multiple });
  await expect(
    page.getByText("每次可导入 1–20 张图片。", { exact: true }),
  ).toBeVisible();
  await expect(images).toHaveCount(1);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  const native = process.platform === "darwin" ? "Meta" : "Control";
  // Use a real native shortcut and browser clipboard, not a synthetic paste handler.
  await page.evaluate(async (encoded) => {
    const blob = new Blob(
      [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
      { type: "image/png" },
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, b64);
  await canvas.focus();
  await page.keyboard.press(`${native}+v`);
  await expect(images).toHaveCount(2);
  await expect(
    canvas.getByRole("button", { name: "上传图片到画布", exact: true }),
  ).toBeEnabled();
  await canvas.focus();
  await page.keyboard.press(`${native}+c`);
  const marker = await page.evaluate(() => navigator.clipboard.readText());
  expect(marker).toMatch(/^Tuyile canvas:[0-9a-f-]+$/);
  await page.keyboard.press(`${native}+v`);
  await expect(images).toHaveCount(3);
  // Replacing the system clipboard with a new screenshot wins over old node copies.
  await page.evaluate(async (encoded) => {
    const blob = new Blob(
      [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
      { type: "image/png" },
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, b64);
  await page.keyboard.press(`${native}+v`);
  await expect(images).toHaveCount(4);
  await page.evaluate(() => navigator.clipboard.writeText("原生文本粘贴"));
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("");
  await prompt.press(`${native}+v`);
  await expect(prompt).toHaveValue("原生文本粘贴");
  await canvas.focus();
  await page.keyboard.press(`${native}+v`);
  await expect(images).toHaveCount(4);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const projectId = page.url().split("/").at(-1)!;
  const saved = await (
    await page.request.get(`/api/projects/${projectId}/canvas`)
  ).json();
  expect(new Set(saved.document.nodes.map((n: any) => n.assetId)).size).toBe(3);
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
  await page.reload();
  await expect(images).toHaveCount(4);
  await transfer.dispose();
  await multiple.dispose();
});

test("canvas batches multiple uploads and drops, packs around existing nodes and retains partial success", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("批量导入排列验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "批量导入排列验证" })
    .click();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await expect(canvas).toBeVisible();
  const sharp = (await import("sharp")).default;
  const buffers = await Promise.all(
    [
      [400, 200],
      [200, 500],
      [300, 300],
    ].map(([width, height]) =>
      sharp({ create: { width, height, channels: 3, background: "#0062b0" } })
        .png()
        .toBuffer(),
    ),
  );
  const file = (name: string, i = 0) => ({
    name,
    mimeType: "image/png",
    buffer: buffers[i],
  });
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/images/uploads")
    )
      uploads++;
  });
  const input = canvas.locator('input[type="file"]');
  const ready = () =>
    expect(
      canvas.getByRole("button", { name: "上传图片到画布", exact: true }),
    ).toBeEnabled();
  const nodes = page.locator(".react-flow__node-image");
  const projectId = page.url().split("/").at(-1)!;
  const saved = async () =>
    (await (await page.request.get(`/api/projects/${projectId}/canvas`)).json())
      .document.nodes;
  await input.setInputFiles(file("已有.png"));
  await expect(nodes).toHaveCount(1);
  await ready();
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const original = (await saved())[0];
  await input.setInputFiles([
    file("宽图.png"),
    file("高图.png", 1),
    file("方图.png", 2),
  ]);
  await expect(nodes).toHaveCount(4);
  await ready();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  const transfer = await page.evaluateHandle((encoded) => {
    const data = new DataTransfer();
    for (const name of ["拖放1.png", "拖放2.png"])
      data.items.add(
        new File(
          [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
          name,
          { type: "image/png" },
        ),
      );
    return data;
  }, buffers[0].toString("base64"));
  await canvas.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(nodes).toHaveCount(6);
  await ready();
  expect(uploads).toBe(6);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const placed = await saved();
  expect(placed[0]).toEqual(original);
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i],
        b = placed[j];
      expect(
        a.x >= b.x + b.width + 24 ||
          b.x >= a.x + a.width + 24 ||
          a.y >= b.y + b.height + 24 ||
          b.y >= a.y + a.height + 24,
      ).toBe(true);
    }
  await page
    .getByTestId("reference-upload")
    .getByRole("button", { name: "引用选中 2 张", exact: true })
    .click();
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(2);
  await input.setInputFiles([
    file("不应上传.png"),
    { name: "不支持.txt", mimeType: "text/plain", buffer: Buffer.from("no") },
  ]);
  await expect(page.getByText(/仅支持 PNG、JPEG 和 WebP/)).toBeVisible();
  expect(uploads).toBe(6);
  await input.setInputFiles([
    file("保留.png"),
    { name: "损坏.png", mimeType: "image/png", buffer: Buffer.from("broken") },
    file("停止.png"),
  ]);
  await expect(page.getByText(/已加入 1\/3 张/)).toBeVisible();
  await ready();
  await expect(nodes).toHaveCount(7);
  expect(uploads).toBe(8);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  await page.reload();
  await expect(nodes).toHaveCount(7);
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
  await transfer.dispose();
});

test("creation panel collapses into a rail without changing viewport or drafts and restores for explicit actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("创作面板折叠验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "创作面板折叠验证" })
    .click();
  const panel = page.getByRole("complementary", {
    name: "图片创作",
    exact: true,
  });
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("折叠仍保留这个创作草稿");
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 320, height: 160, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  await canvas.locator('input[type="file"]').setInputFiles({
    name: "面板素材.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await expect(
    canvas.getByRole("button", { name: "上传图片到画布", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Zoom Out", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/api/projects/${page.url().split("/").at(-1)}/canvas`,
            )
          ).json()
        ).document.viewport.zoom,
    )
    .toBeLessThan(1);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const projectId = page.url().split("/").at(-1)!;
  const snapshot = async () =>
    await (await page.request.get(`/api/projects/${projectId}/canvas`)).json();
  const before = await snapshot();
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("真实摄影", { exact: true })
    .click();
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(page.locator(".style-editor")).toBeVisible();
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  const expand = page.getByRole("button", {
    name: "直接创作面板",
    exact: true,
  });
  await expect(expand).toBeFocused();
  await expect(page.locator(".style-editor")).not.toBeVisible();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(40, 0);
  expect((await snapshot()).document.viewport).toEqual(
    before.document.viewport,
  );
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${projectId}/draft`)
          ).json()
        ).document.direct.prompt,
    )
    .toBe("折叠仍保留这个创作草稿");
  await page.reload();
  await expect(expand).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(350);
  await expect(prompt).toHaveValue("折叠仍保留这个创作草稿");
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(1);
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  await expand.click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => (await panel.boundingBox())!.width)
      .toBeGreaterThan(350);
    const pin = page.getByRole("button", { name: "固定创作面板", exact: true });
    if (await pin.count()) await pin.click();
    await expect
      .poll(async () => (await panel.boundingBox())!.width)
      .toBeCloseTo(Math.min(440, Math.max(360, width * 0.285)) + 40, 0);
    await expect
      .poll(
        async () =>
          (await page.locator(".creation-layout").boundingBox())!.width -
          (await canvas.boundingBox())!.width,
      )
      .toBeCloseTo(Math.min(440, Math.max(360, width * 0.285)) + 40, 0);
    const expandedCanvas = (await canvas.boundingBox())!.width;
    const current = (await snapshot()).document.viewport;
    await page
      .locator('.creation-tool-rail button[aria-pressed="true"]')
      .click();
    await expect
      .poll(async () => (await panel.boundingBox())!.width)
      .toBeCloseTo(40, 0);
    expect((await canvas.boundingBox())!.width).toBeGreaterThan(
      expandedCanvas + 300,
    );
    expect((await snapshot()).document.viewport).toEqual(current);
    await page.screenshot({
      path: `.codex-temp/creation-panel-collapsed-${width}.png`,
    });
    await expand.click();
    await expect
      .poll(async () => (await panel.boundingBox())!.width)
      .toBeGreaterThan(350);
    await expect(prompt).toHaveValue("折叠仍保留这个创作草稿");
  }
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await page
    .locator(".react-flow__node-image")
    .first()
    .click({ position: { x: 30, y: 30 } });
  await expect(expand).toBeVisible();
  await page
    .locator(".react-flow__node-toolbar")
    .getByRole("button", { name: "作为参考图", exact: true })
    .click();
  await expect(
    page.locator('.creation-tool-rail button[aria-pressed="true"]'),
  ).toBeVisible();
  await expect(
    page.getByTestId("reference-upload").locator(".attachment"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/images/tasks?projectId=${projectId}`)
          ).json()
        ).tasks[0]?.state,
    )
    .toBe("succeeded");
  await expect(expand).toBeVisible();
  await expand.click();
  await page
    .getByRole("button", { name: "取消固定创作面板", exact: true })
    .click();
  await page
    .getByRole("button", { name: "任务与结果 · 1", exact: true })
    .click();
  const detailsTrigger = page.getByRole("button", {
    name: "任务详情",
    exact: true,
  });
  await detailsTrigger.click();
  await expect(detailsTrigger).toHaveAttribute("aria-expanded", "true");
  await detailsTrigger.press("Escape");
  await expect(detailsTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.locator('.creation-tool-rail button[aria-pressed="true"]'),
  ).toBeVisible();
  await detailsTrigger.press("Escape");
  await expect(expand).toBeVisible();
  await expect(expand).toBeFocused();
  const generated = page
    .locator(".react-flow__node-image")
    .filter({ has: page.getByRole("img", { name: "生成图片", exact: true }) });
  await generated.hover();
  await page
    .locator(".react-flow__node-toolbar")
    .getByRole("button", { name: "复用图片设置", exact: true })
    .click();
  await expect(
    page.locator('.creation-tool-rail button[aria-pressed="true"]'),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(prompt).toHaveValue("折叠仍保留这个创作草稿");
  for (let i = 0; i < 2; i++) {
    await page
      .locator('.creation-tool-rail button[aria-pressed="true"]')
      .click();
    await canvas.locator('input[type="file"]').setInputFiles({
      name: "相同错误.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("unsupported"),
    });
    await expect(
      page.locator('.creation-tool-rail button[aria-pressed="true"]'),
    ).toBeVisible();
    await expect(page.getByText(/仅支持 PNG、JPEG 和 WebP/)).toBeVisible();
  }
});

test("collapsed creation panel retains unsaved Agent edits and closes its settings popup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("折叠保留Agent方案");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "折叠保留Agent方案" })
    .click();
  const projectId = page.url().split("/").at(-1)!;
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrfToken,
  };
  expect(
    (
      await page.request.post("/api/image-admin/planning-providers", {
        headers,
        data: { mode: "fake", baseUrl: "", model: "collapse-planner" },
      })
    ).ok(),
  ).toBe(true);
  const job = await (
    await page.request.post("/api/agent/planning", {
      headers,
      data: {
        projectId,
        requestKey: randomUUID(),
        prompt: "合成商品方案",
        model: "test-image",
        width: 256,
        height: 256,
        quality: "medium",
        format: "png",
        referenceIds: [],
      },
    })
  ).json();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/agent/jobs?projectId=${projectId}`)
          ).json()
        ).jobs.find((j: any) => j.id === job.id)?.state,
    )
    .toBe("succeeded");
  await selectCreationPanel(page, "agent");
  await page.getByRole("button", { name: "编辑提示词", exact: true }).click();
  const title = page.getByLabel("步骤 1 名称", { exact: true });
  await title.fill("未保存但需要保留的方案");
  await page.getByRole("button", { name: "直接创作面板", exact: true }).click();
  await expect(page.getByLabel("创作需求", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
  await expect(title).toHaveValue("未保存但需要保留的方案");
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
  await expect(title).toHaveValue("未保存但需要保留的方案");
  await page.getByRole("button", { name: "保存计划修改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存计划修改", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "继续聊想法", exact: true }).click();
  await page.getByRole("button", { name: "创作设置", exact: true }).click();
  await expect(page.locator(".agent-settings-popover")).toBeVisible();
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await expect(page.locator(".agent-settings-popover")).not.toBeVisible();
  await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
  await expect(page.locator(".agent-settings-popover")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Agent 面板", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "取消固定创作面板", exact: true })
    .click();
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await page.mouse.move(300, 500);
  await page.getByRole("button", { name: "Agent 面板", exact: true }).hover();
  await expect(
    page.locator('.creation-tool-rail button[aria-pressed="true"]'),
  ).toBeVisible();
  await expect(
    page.getByLabel("告诉 Agent 你的想法", { exact: true }),
  ).not.toBeFocused();
  const settingsTrigger = page.getByRole("button", {
    name: "创作设置",
    exact: true,
  });
  await settingsTrigger.click();
  await expect(settingsTrigger).toBeFocused();
  await settingsTrigger.press("Escape");
  const clear = page
    .locator(".agent-conversation-heading")
    .getByRole("button", { name: "清空规划对话", exact: true });
  await expect(clear).toHaveText("清空");
  await expect(
    page
      .locator(".creation-panel-heading")
      .getByRole("button", { name: "清空规划对话", exact: true }),
  ).toHaveCount(0);
  await clear.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(clear).toBeVisible();
  await clear.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(clear).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "先聊想法，再确认创作", exact: true }),
  ).toBeVisible();
});

test("anchored creation panel previews on hover, pins durably and dismisses without consuming canvas actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("锚定面板交互验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "锚定面板交互验证" })
    .click();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  const panel = page.getByRole("complementary", {
    name: "图片创作",
    exact: true,
  });
  const expand = page.getByRole("button", {
    name: "直接创作面板",
    exact: true,
  });
  const collapse = page.locator(
    '.creation-tool-rail button[aria-pressed="true"]',
  );
  const pin = page.getByRole("button", { name: "固定创作面板", exact: true });
  const unpin = page.getByRole("button", {
    name: "取消固定创作面板",
    exact: true,
  });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 300, height: 160, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  await canvas.locator('input[type="file"]').setInputFiles({
    name: "点击选择验证.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node-image .canvas-image-caption"),
  ).toHaveText("点击选择验证.png");

  await expect(
    canvas.getByRole("button", { name: "上传图片到画布", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 10, y: 100 } });
  await expect(collapse).toBeVisible();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  const projectId = page.url().split("/").at(-1)!;
  const viewport = (
    await (await page.request.get(`/api/projects/${projectId}/canvas`)).json()
  ).document.viewport;
  const pinnedWidth = (await canvas.boundingBox())!.width;
  await unpin.click();
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeGreaterThan(pinnedWidth + 300);
  await expect
    .poll(
      async () =>
        (await page.locator(".creation-layout").boundingBox())!.width -
        (await canvas.boundingBox())!.width,
    )
    .toBeCloseTo(40, 0);
  const floatingWidth = (await canvas.boundingBox())!.width;
  await page
    .locator(".react-flow__node-image")
    .click({ position: { x: 20, y: 30 } });
  await expect(expand).toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveClass(/selected/);
  expect((await canvas.boundingBox())!.width).toBeCloseTo(floatingWidth, 0);
  await page.clock.install();
  await expand.hover();
  await page.clock.fastForward(350);
  await expect(collapse).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBeCloseTo(floatingWidth, 0);
  await page.mouse.move(300, 500);
  await page.clock.fastForward(250);
  await expect(expand).toBeVisible();
  await expand.hover();
  await page.clock.fastForward(350);
  await page.keyboard.press("Escape");
  await expect(expand).toBeVisible();
  await page.mouse.move(300, 500);
  await expand.hover();
  await page.clock.fastForward(350);
  const prompt = page.getByLabel("创作需求", { exact: true });
  await prompt.fill("临时编辑也要保留");
  await page.mouse.move(300, 500);
  await page.clock.fastForward(500);
  await expect(collapse).toBeVisible();
  await page.getByRole("button", { name: "更多提示词", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(collapse).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(expand).toBeVisible();
  await expect(expand).toBeFocused();
  await expand.click();
  await prompt.dispatchEvent("compositionstart");
  await prompt.press("Escape");
  await expect(collapse).toBeVisible();
  await prompt.dispatchEvent("compositionend");
  await prompt.press("Escape");
  await expect(expand).toBeVisible();
  await expand.click();
  await pin.click();
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 10, y: 100 } });
  await expect(collapse).toBeVisible();
  await page.clock.fastForward(1500);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${projectId}/draft`)
          ).json()
        ).document.direct.prompt,
    )
    .toBe("临时编辑也要保留");
  await page.reload();
  await expect(unpin).toBeVisible();
  await unpin.click();
  await page.reload();
  await expect(expand).toBeVisible();
  expect(
    (await (await page.request.get(`/api/projects/${projectId}/canvas`)).json())
      .document.viewport,
  ).toEqual(viewport);
  await page.screenshot({ path: ".codex-temp/anchored-panel-rail.png" });
  await expand.click();
  await expect(collapse).toBeVisible();
  await page.screenshot({ path: ".codex-temp/anchored-panel-preview.png" });
});

test("two tool-window rail icons switch independent drafts and hiding preserves pin mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("双面板图标验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "双面板图标验证" })
    .click();
  const direct = page.getByRole("button", {
    name: "直接创作面板",
    exact: true,
  });
  const agent = page.getByRole("button", { name: "Agent 面板", exact: true });
  const panel = page.getByRole("complementary", {
    name: "图片创作",
    exact: true,
  });
  const unpin = page.getByRole("button", {
    name: "取消固定创作面板",
    exact: true,
  });
  await expect(direct).toHaveAttribute("aria-pressed", "true");
  await expect(agent).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("创作需求", { exact: true }).fill("独立的直接创作草稿");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-pressed", "true");
  await page
    .getByLabel("告诉 Agent 你的想法", { exact: true })
    .fill("独立的Agent想法");
  await direct.click();
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "独立的直接创作草稿",
  );
  await agent.click();
  await expect(
    page.getByLabel("告诉 Agent 你的想法", { exact: true }),
  ).toHaveValue("独立的Agent想法");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(40, 0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tuyile.creation-panel-pinned"),
    ),
  ).toBe("true");
  await direct.click();
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await page.locator('.creation-tool-rail button[aria-pressed="true"]').click();
  await agent.click();
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await unpin.click();
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 10, y: 100 } });
  await expect(agent).toHaveAttribute("aria-pressed", "false");
  await direct.hover();
  await expect(direct).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "独立的直接创作草稿",
  );
  await page.mouse.move(300, 500);
  await expect(direct).toHaveAttribute("aria-pressed", "false");
  await agent.hover();
  await expect(agent).toHaveAttribute("aria-pressed", "true");
  await agent.click();
  await page.mouse.move(300, 500);
  await expect(agent).toHaveAttribute("aria-pressed", "true");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-pressed", "false");
  const projectId = page.url().split("/").at(-1)!;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${projectId}/draft`)
          ).json()
        ).document.agent.prompt,
    )
    .toBe("独立的Agent想法");
  await page.reload();
  await expect(direct).toBeVisible();
  await expect(agent).toBeVisible();
  await expect(
    page
      .getByRole("toolbar", { name: "创作面板导航", exact: true })
      .getByRole("button"),
  ).toHaveCount(2);
  await expect(direct).toHaveAttribute("aria-pressed", "false");
  await expect(agent).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: ".codex-temp/two-tool-window-rail.png" });
  await agent.click();
  await expect(
    page.getByLabel("告诉 Agent 你的想法", { exact: true }),
  ).toHaveValue("独立的Agent想法");
  expect(
    (
      await (
        await page.request.get(`/api/images/tasks?projectId=${projectId}`)
      ).json()
    ).tasks,
  ).toHaveLength(0);
});

test("creation header is a compact single row and mode switching stays on the tool rail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("紧凑标题栏验证");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "紧凑标题栏验证" })
    .click();
  await expect(
    page
      .locator(".main-column > header")
      .getByRole("link", { name: "返回项目", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".main-column > header")
      .getByRole("heading", { name: "紧凑标题栏验证", exact: true }),
  ).toBeVisible();
  const panel = page.getByRole("complementary", {
    name: "图片创作",
    exact: true,
  });
  const header = panel.locator(".creation-panel-heading");
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["direct", "agent"] as const) {
      await selectCreationPanel(page, mode);
      await expect(
        header.getByRole("heading", {
          name: mode === "direct" ? "直接创作" : "Agent",
          exact: true,
        }),
      ).toBeVisible();
      await expect(panel.getByRole("tablist")).toHaveCount(0);
      await expect
        .poll(async () => (await header.boundingBox())!.height)
        .toBeCloseTo(28, 0);
      const panelBox = (await panel.boundingBox())!,
        headBox = (await header.boundingBox())!;
      expect(headBox.y - panelBox.y).toBeCloseTo(8, 0);
      await expect(header.getByRole("button")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "收起创作面板", exact: true }),
      ).toHaveCount(0);
      const titleBox = (await header.getByRole("heading").boundingBox())!;
      const pin = header.getByRole("button", {
        name: "取消固定创作面板",
        exact: true,
      });
      const pinBox = (await pin.boundingBox())!;
      expect(pinBox.x - titleBox.x - titleBox.width).toBeCloseTo(4, 0);
      expect(pinBox.width).toBe(24);
      expect(pinBox.height).toBe(24);
      expect(
        await pin.evaluate((el) => getComputedStyle(el).borderTopWidth),
      ).toBe("0px");
      await expect(
        panel.getByRole("button", { name: "清空规划对话", exact: true }),
      ).toHaveCount(0);
      const controls = [
        panel.getByRole("button", { name: "取消固定创作面板", exact: true }),
      ];
      for (const control of controls) {
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(headBox.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(
          headBox.y + headBox.height + 1,
        );
      }
      await expect(pin.locator("svg")).toHaveClass(/lucide-pin(?:\s|$)/);
      // Sample every rendered frame, including the grid's 200ms transition.
      for (const pinned of [false, true]) {
        const samples = await header
          .getByRole("button")
          .evaluate(async (button) => {
            const panel = button.closest(".creation-panel")!;
            const frames: { x: number; width: number; height: number }[] = [];
            const capture = () => {
              const { x, width, height } = panel.getBoundingClientRect();
              frames.push({ x, width, height });
            };
            capture();
            (button as HTMLButtonElement).click();
            const start = performance.now();
            do {
              await new Promise(requestAnimationFrame);
              capture();
            } while (performance.now() - start < 300);
            return frames;
          });
        for (const sample of samples) {
          expect(sample.x).toBeCloseTo(panelBox.x, 0);
          expect(sample.width).toBeCloseTo(panelBox.width, 0);
          expect(sample.height).toBeCloseTo(panelBox.height, 0);
        }
        const control = header.getByRole("button");
        await expect(control).toHaveAttribute("aria-pressed", String(pinned));
        await expect(control.locator("svg")).toHaveClass(
          pinned ? /lucide-pin(?:\s|$)/ : /lucide-pin-off/,
        );
      }
      await page.screenshot({
        path: `.codex-temp/compact-header-${mode}-${width}.png`,
      });
    }
  }
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await page
    .locator(".project-card")
    .filter({ hasText: "紧凑标题栏验证" })
    .click();
  await expect(
    page
      .locator(".main-column > header")
      .getByRole("heading", { name: "紧凑标题栏验证", exact: true }),
  ).toBeVisible();
});

test("canvas image captions remain separate from group titles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByLabel("项目名称").fill("图片标题与分组验收");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "图片标题与分组验收" })
    .click();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 300, height: 200, channels: 3, background: "#173D32" },
    })
    .png()
    .toBuffer();
  await canvas.locator('input[type="file"]').setInputFiles([
    { name: "A · 品牌标志.png", mimeType: "image/png", buffer: png },
    { name: "B · 产品插画.png", mimeType: "image/png", buffer: png },
  ]);
  const captions = page.locator(".canvas-image-caption");
  await expect(captions).toHaveText(["A · 品牌标志.png", "B · 产品插画.png"]);
  await canvas.focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+a" : "Control+a",
  );
  await page.getByRole("button", { name: "分组", exact: true }).click();
  const groupTitle = page.locator(".canvas-group > span");
  await expect(groupTitle).toHaveText("图片分组");
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const title = (await groupTitle.boundingBox())!;
    for (const caption of await captions.all()) {
      const box = (await caption.boundingBox())!;
      expect(box.y).toBeGreaterThan(title.y + title.height);
    }
    await page.screenshot({
      path: `.codex-temp/captions-group-${width}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Move the group clear of the persistent save-status overlay before editing its title.
  const canvasBox = (await canvas.boundingBox())!;
  await page.mouse.move(canvasBox.x + 20, canvasBox.y + 400);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 60, canvasBox.y + 500, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await groupTitle.boundingBox())!.y)
    .toBeGreaterThan(canvasBox.y + 70);
  await captions.first().dblclick();
  const imageName = page.getByRole("textbox", {
    name: "图片名称",
    exact: true,
  });
  await expect(imageName).toBeFocused();
  const titleStyle = async (locator: import("@playwright/test").Locator) =>
    locator.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        border: s.borderTopWidth,
        height: s.height,
        padding: s.paddingLeft,
      };
    });
  await expect
    .poll(() => titleStyle(imageName))
    .toEqual({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      height: "18px",
      padding: "0px",
    });

  await imageName.fill("A · 可编辑的品牌标志");
  await imageName.press("Enter");
  await expect(captions.first()).toHaveText("A · 可编辑的品牌标志");
  await expect(imageName).toHaveCount(0);
  await expect
    .poll(() => titleStyle(captions.first()))
    .toMatchObject({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      height: "18px",
    });
  await expect
    .poll(() => titleStyle(captions.first().locator('[role="button"]')))
    .toMatchObject({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      height: "18px",
    });

  await expect(page.locator(".ant-image-preview")).toBeHidden();
  await expect(captions.first().locator('[role="button"]')).toBeFocused();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(captions.first()).toHaveText("A · 品牌标志.png");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(captions.first()).toHaveText("A · 可编辑的品牌标志");
  await captions.first().dblclick();
  await imageName.fill("取消这次修改");
  await imageName.dispatchEvent("compositionstart");
  await imageName.press("Enter");
  await expect(imageName).toBeVisible();
  await imageName.dispatchEvent("compositionend");
  await imageName.press("Escape");
  await expect(captions.first()).toHaveText("A · 可编辑的品牌标志");
  await captions.first().dblclick();
  await imageName.fill("   ");
  await imageName.press("Enter");
  await expect(captions.first()).toHaveText("A · 可编辑的品牌标志");
  await groupTitle.dblclick();
  const groupName = page.getByRole("textbox", {
    name: "分组标题",
    exact: true,
  });
  await expect
    .poll(() => titleStyle(groupName))
    .toEqual({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      height: "18px",
      padding: "0px",
    });
  await groupName.fill("品牌素材");
  await canvas
    .locator(".react-flow__pane")
    .click({ position: { x: 10, y: 400 } });
  await expect(groupTitle).toHaveText("品牌素材");
  await expect(groupName).toHaveCount(0);
  await expect
    .poll(() => titleStyle(groupTitle))
    .toMatchObject({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      height: "18px",
    });

  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(groupTitle).toHaveText("图片分组");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(groupTitle).toHaveText("品牌素材");
  await groupTitle.locator('[role="button"]').focus();
  await page.keyboard.press("F2");
  await expect(groupName).toBeFocused();
  await groupName.press("Escape");
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  await page.reload();
  await expect(captions.first()).toHaveText("A · 可编辑的品牌标志");
  await expect(groupTitle).toHaveText("品牌素材");
  await page
    .locator(".react-flow__node-image")
    .first()
    .dblclick({ position: { x: 100, y: 100 } });
  await expect(page.locator(".ant-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview")).toBeHidden();
});
