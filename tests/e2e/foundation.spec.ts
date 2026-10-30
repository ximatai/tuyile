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
async function logoutFromMenu(page: Page) {
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
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
  await page.getByRole("button", { name: "产品海报", exact: true }).click();
  await expect(page.getByLabel("创作需求")).toHaveValue(/高端商业海报/);
  const authoredPrompt = await page.getByLabel("创作需求").inputValue();
  await page.getByRole("combobox", { name: "风格", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("真实摄影", { exact: true })
    .click();
  await expect(page.getByLabel("创作需求")).toHaveValue(authoredPrompt);
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  await page
    .getByLabel("风格描述", { exact: true })
    .fill("合成风格：柔和自然光");
  await expect(page.getByLabel("创作需求")).toHaveValue(authoredPrompt);
  await page.getByRole("button", { name: "编辑风格", exact: true }).click();
  const styledDraft = await page.getByLabel("创作需求").inputValue();
  await page.getByRole("button", { name: "城市夜景", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByLabel("创作需求")).toHaveValue(styledDraft);
  const resolutionHeading = page
    .locator(".direct-creation .field-heading")
    .filter({ has: page.getByLabel("实际尺寸", { exact: true }) });
  await expect(resolutionHeading).toContainText("尺寸");
  const headingGeometry = await resolutionHeading.evaluate((heading) => {
    const title = heading.querySelector("label")!.getBoundingClientRect();
    const pixels = heading
      .querySelector(".size-pixels")!
      .getBoundingClientRect();
    return {
      sameLine: Math.abs(title.top - pixels.top) < 3,
      fits: heading.scrollWidth <= heading.clientWidth,
    };
  });
  expect(headingGeometry).toEqual({ sameLine: true, fits: true });
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
  await expect(page.getByLabel("实际尺寸", { exact: true })).toHaveText(
    "2048 × 1152 px",
  );
  await page.getByRole("combobox", { name: "尺寸", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^1824 × 1024$/ })
    .click();
  await expect(page.getByLabel("实际尺寸", { exact: true })).toHaveText(
    "1824 × 1024 px",
  );
  await page.getByRole("combobox", { name: "尺寸", exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("1280 × 720 · 720p", { exact: true })
    .click();
  await expect(page.getByLabel("实际尺寸", { exact: true })).toHaveText(
    "1280 × 720 px",
  );
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
  await expect(page.getByLabel("实际尺寸", { exact: true })).toHaveText(
    "1008 × 1024 px",
  );
  await page.getByLabel("宽度", { exact: true }).fill("1024");
  await page.getByRole("button", { name: "自定义尺寸", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "格式", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "后台执行与计费", exact: true })
    .click();
  await expect(
    page.getByText(
      "取消可能仍计费；Worker 中断后不自动续跑，已保存结果会保留。",
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
      .getByText("自定义风格", { exact: true }),
  ).toBeVisible();

  let releaseSubmission!: () => void;
  const submissionGate = new Promise<void>((resolve) => {
    releaseSubmission = resolve;
  });
  await page.route(
    "**/api/images/tasks",
    async (route) => {
      expect(route.request().postDataJSON().style).toEqual({
        name: "自定义风格",
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
  await expect(page.locator(".direct-creation form > .primary")).toHaveClass(
    /ant-btn-loading/,
  );
  releaseSubmission();
  await expect(
    page.getByRole("status", { name: "图片生成状态" }),
  ).toContainText(/正在生成图片|排队中/);
  await expect(page.getByLabel("创作需求")).toHaveValue("");
  await expect(page.locator(".direct-creation form > .primary")).toHaveClass(
    /ant-btn-loading/,
  );
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
  await expect(page.getByText("合成测试：关闭页面后继续执行")).toBeVisible();
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 1440, height: 900 });
  await reopened.goto(projectUrl);
  await reopened
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await expect(
    reopened.getByRole("heading", { name: "已完成", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).toContainText("已生成");
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
  await reopened.getByRole("button", { name: "复用设置", exact: true }).click();
  await expect(reopened.getByLabel("创作需求")).toHaveValue(
    "合成测试：关闭页面后继续执行",
  );
  await expect(
    reopened.locator(".direct-creation .field").filter({
      has: reopened.getByRole("combobox", { name: "风格", exact: true }),
    }),
  ).toContainText("自定义风格");
  await reopened.getByRole("button", { name: "编辑风格", exact: true }).click();
  await expect(reopened.getByLabel("风格描述", { exact: true })).toHaveValue(
    "合成风格：柔和自然光",
  );
  await reopened.getByRole("button", { name: "编辑风格", exact: true }).click();
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
  await reopened
    .getByRole("button", { name: "继续修改", exact: true })
    .first()
    .click();
  await expect(
    reopened
      .getByTestId("reference-upload")
      .getByText("画布参考图", { exact: true }),
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
  expect(sentStyleRequest.style.text).toContain("鲜明的海报构图");
  await expect(
    reopened.getByRole("status", { name: "图片生成状态" }),
  ).toContainText("提交结果待确认");
  await reopened
    .getByRole("button", { name: "查找这次提交", exact: true })
    .click();
  await expect(reopened.getByLabel("创作需求")).toHaveValue("");
  expect(
    (
      await (
        await reopened.request.get(
          `/api/images/tasks?projectId=${projectUrl.split("/").at(-1)}`,
        )
      ).json()
    ).tasks,
  ).toHaveLength(2);
  await expect(reopened.getByText("合成测试：注销后继续")).toBeVisible();
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
  await expect(
    reopened.getByTestId("reference-upload").getByText("synthetic.png"),
  ).toBeVisible();
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
    .locator(".quota-details button")
    .boundingBox();
  expect(submitBox).not.toBeNull();
  expect(quotaBox).not.toBeNull();
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(quotaBox!.y);
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
  expect(cardLayout[0]!.width).toBeLessThan(500);
  expect(Math.abs(cardLayout[0]!.y - cardLayout[1]!.y)).toBeLessThan(2);
  expect(cardLayout[1]!.x).toBeGreaterThan(cardLayout[0]!.x);
  const quotaTrigger = reopened.locator(".quota-details button");
  await quotaTrigger.focus();
  await reopened.keyboard.press("Enter");
  await expect(quotaTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(reopened.getByRole("tooltip")).toBeVisible();
  await reopened.keyboard.press("Escape");
  await expect(reopened.getByRole("tooltip")).toBeHidden();
  await expect(quotaTrigger).toBeFocused();
  await quotaTrigger.click();
  await reopened.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(reopened.getByRole("tooltip")).toBeHidden();
  await reopened.getByRole("tab", { name: "直接创作", exact: true }).click();
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
    reopened.getByRole("heading", { name: "上传的参考图" }),
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
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
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
  await page
    .getByRole("button", { name: "将 test-planner 加入对话池", exact: true })
    .click();
  const chatPool = page.getByRole("region", {
    name: "对话模型池",
    exact: true,
  });
  await chatPool.getByRole("button", { name: "能力设置", exact: true }).click();
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
  await page.getByLabel("模型最大边长", { exact: true }).fill("2048");
  const sizes = page.getByLabel(/^限定尺寸/);
  const abilitySave = await page
    .getByRole("button", { name: "应用到待发布配置", exact: true })
    .boundingBox();
  expect(abilitySave!.y + abilitySave!.height).toBeLessThanOrEqual(1000);
  await sizes.pressSequentially("1024x1024,512x512");
  await expect(sizes).toHaveValue("1024x1024,512x512");
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
  await page.getByRole("button", { name: "保存开放配置", exact: true }).click();
  await expect(
    page.getByText("模型开放配置已保存，新的创作可以使用。", { exact: true }),
  ).toBeVisible();
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
      .getByText("画布参考图", { exact: true }),
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
  await node.hover();
  const more = imageActions.getByRole("button", {
    name: "更多图片操作",
    exact: true,
  });
  await expect(more).toBeVisible();
  const smallButton = (await more.boundingBox())!;
  expect(smallButton.width).toBeCloseTo(fullButton!.width, 0);
  expect(smallButton.height).toBeCloseTo(fullButton!.height, 0);
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
      .getByText("画布参考图", { exact: true }),
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
    const quota = (await page.locator(".quota-details button").boundingBox())!;
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
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("Agent 顺序创作");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "Agent 顺序创作" })
    .click();
  const projectId = page.url().split("/").at(-1)!;
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "灵感与风格", exact: true }).click();
  await expect(
    page
      .getByRole("tooltip")
      .getByRole("button", { name: "产品海报", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "灵感与风格", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "灵感与风格", exact: true }),
  ).toBeFocused();
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
  await expect(page.locator(".agent-confirm-footer")).toContainText(
    "确认后后台执行",
  );
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
  await page
    .getByRole("combobox", { name: "步骤 1 张数", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("2 张", { exact: true })
    .click();
  await page.getByRole("button", { name: "添加步骤", exact: true }).click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "步骤 2 张数", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("1 张", { exact: true })
    .click();
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
  await expect(
    page.locator(".field").filter({
      has: page.getByRole("combobox", { name: "步骤 1 张数", exact: true }),
    }),
  ).toContainText("2 张");
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
  await page.reload();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
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
    .getByRole("button", { name: "复用设置", exact: true })
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
  await expect(page.getByText("收藏已保存。", { exact: true })).toBeVisible();
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
      .getByText("图库参考图", { exact: true }),
  ).toBeVisible();
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
  await expect(page.locator(".ant-drawer:visible")).toHaveCount(0);
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
  await expect(page.locator(".ant-drawer:visible")).toHaveCount(0);
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
  await page
    .context()
    .storageState({ path: ".codex-temp/model-pools-admin-session.json" });
});

test("administrators add a service and users select same-named models from the correct service", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const savedSession = JSON.parse(
    await readFile(".codex-temp/model-pools-admin-session.json", "utf8"),
  );
  await page.context().addCookies(savedSession.cookies);
  await page.goto("/projects");
  await page.goto("/admin/images");
  await page.getByRole("button", { name: "新增服务", exact: true }).click();
  await page.getByLabel("服务名称", { exact: true }).fill("备用测试服务");
  await page.getByLabel("接入协议", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("本地合成测试（不调用模型）", { exact: true })
    .click();
  await page.getByRole("button", { name: "保存服务", exact: true }).click();
  await expect(
    page.getByText("服务已保存，可以获取模型列表。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await page.getByRole("button", { name: "手动登记模型", exact: true }).click();
  await page.getByLabel("模型 ID", { exact: true }).fill("invalid model");
  await page.getByRole("button", { name: "登记候选模型", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByLabel("模型 ID", { exact: true }).fill("manual-candidate");
  await page.getByRole("button", { name: "登记候选模型", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("button", { name: "将 test-image 加入图像生成池", exact: true })
    .click();
  await page
    .getByRole("button", { name: "将 test-planner 加入对话池", exact: true })
    .click();
  await page.getByRole("button", { name: "保存开放配置", exact: true }).click();
  await expect(
    page.getByText("模型开放配置已保存，新的创作可以使用。", { exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByText("当前尺寸不受支持，请选择画面规格。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("宽度", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "自定义尺寸", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "提交图片任务", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("比例", { exact: true }).click();
  await expect(
    page
      .locator(".ant-select-dropdown:visible")
      .locator(".ant-select-item-option-content")
      .filter({ hasText: /^3:4$/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.unroute(usageRoute);
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
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page
    .getByText("创作设置 · 通用创作 · test-image", { exact: true })
    .click();
  await page.getByLabel("对话模型", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("test-planner · 备用测试服务", { exact: true })
    .click();
  await page
    .getByLabel("告诉 Agent 你的想法", { exact: true })
    .fill("Synthetic plan using selected service");
  const planningRequest = page.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/agent/planning",
  );
  await page.getByRole("button", { name: "发送规划需求", exact: true }).click();
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
    .getByRole("combobox", { name: "模型服务", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("备用测试服务", { exact: true })
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
  await page.getByRole("button", { name: "服务管理", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  const menu = await page.getByRole("menu").boundingBox();
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await page.screenshot({
    path: ".codex-temp/ui-clarity-models-1440.png",
    fullPage: true,
  });
});
