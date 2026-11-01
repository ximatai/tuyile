import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const auth = JSON.parse(
  await readFile(".codex-temp/docker-login.json", "utf8"),
);
const browser = await chromium.launch({ channel: "chromium" });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|style-src|script-src/i.test(m.text())
    )
      errors.push(m.text().slice(0, 140));
  });
  const response = await page.goto("http://127.0.0.1:8792/login");
  assert.match(
    response!.headers()["content-security-policy"],
    /style-src[^;]*nonce-/,
  );
  await page.getByLabel("账号", { exact: true }).fill(auth.username);
  await page.getByLabel("密码", { exact: true }).fill(auth.password);
  const login = page.getByRole("button", { name: "登录", exact: true });
  assert.equal(
    await login.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(0, 98, 176)",
  );
  await login.click();
  await page.getByRole("heading", { name: "我的项目", exact: true }).waitFor();
  assert.equal(
    (await page.locator(".main-column > header").boundingBox())!.height,
    48,
  );
  await page
    .getByRole("button", { name: "账户菜单", exact: true })
    .press("Enter");
  await page.getByRole("menuitem", { name: "修改密码", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "修改密码", exact: true })
    .press("Enter");
  const passwordDialog = page.getByRole("dialog", {
    name: "修改密码",
    exact: true,
  });
  await passwordDialog.waitFor();
  assert.equal(new URL(page.url()).pathname, "/projects");
  await passwordDialog.getByLabel("当前密码").fill("discarded-password-draft");
  await passwordDialog.getByLabel("当前密码").press("Escape");
  await passwordDialog.waitFor({ state: "hidden" });
  await page
    .getByRole("link", { name: /Docker synthetic acceptance/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "提交图片任务", exact: true })
    .waitFor();
  await page.locator("header .header-usage").waitFor();
  const submit = await page
    .getByRole("button", { name: "提交图片任务", exact: true })
    .boundingBox();
  const quota = await page.locator("header .header-usage").boundingBox();
  assert(submit && quota && quota.y + quota.height <= submit.y);
  const uploadPng = await (
    await import("sharp")
  )
    .default({
      create: { width: 400, height: 200, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  const canvasSurface = page.getByRole("region", {
    name: "项目画布",
    exact: true,
  });
  const panelPrompt = page.getByLabel("创作需求", { exact: true });
  await panelPrompt.fill("Docker retained panel draft");
  const panel = page.getByRole("complementary", {
    name: "图片创作",
    exact: true,
  });
  await page.getByRole("button", { name: "收起创作面板", exact: true }).click();
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector(".creation-panel")!.getBoundingClientRect()
          .width - 40,
      ) < 0.5,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "直接创作面板", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await page.screenshot({
    path: ".codex-temp/docker-creation-panel-collapsed.png",
  });
  await page.getByRole("button", { name: "直接创作面板", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".creation-panel")!.getBoundingClientRect().width >
      350,
  );
  assert.equal(await panelPrompt.inputValue(), "Docker retained panel draft");

  assert.equal(
    await page
      .getByRole("button", { name: "取消固定创作面板", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "取消固定创作面板", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector(".creation-results")!.getBoundingClientRect()
          .width -
          (document.querySelector(".creation-layout")!.getBoundingClientRect()
            .width -
            40),
      ) < 0.5,
  );
  const floatingCanvasWidth = (await canvasSurface.boundingBox())!.width;
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 10, y: 100 } });
  await page
    .getByRole("button", { name: "直接创作面板", exact: true })
    .waitFor();
  assert(
    Math.abs((await canvasSurface.boundingBox())!.width - floatingCanvasWidth) <
      1,
  );
  await page.getByRole("button", { name: "直接创作面板", exact: true }).click();
  await page.getByRole("button", { name: "固定创作面板", exact: true }).click();

  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector(".creation-panel")!.getBoundingClientRect()
          .width -
          (Math.min(440, Math.max(360, innerWidth * 0.285)) + 40),
      ) < 0.5,
  );
  assert((await panel.boundingBox())!.width > 350);
  const dropped = await page.evaluateHandle((encoded) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
        "Docker canvas upload.png",
        { type: "image/png" },
      ),
    );
    return data;
  }, uploadPng.toString("base64"));
  await canvasSurface.dispatchEvent("drop", { dataTransfer: dropped });
  await dropped.dispose();
  const uploadedImage = page.locator(
    '.react-flow__node-image img[alt="Docker canvas upload.png"]',
  );
  await uploadedImage.waitFor();
  const uploadedAssetId = (await uploadedImage.getAttribute("src"))!.split(
    "/",
  )[4];
  await page
    .getByTestId("reference-upload")
    .getByRole("button", { name: "引用选中 1 张", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "移除引用 Docker canvas upload.png",
      exact: true,
    })
    .click();
  await uploadedImage.waitFor();
  await page
    .getByRole("button", { name: "上传图片到画布", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>(
        'button[aria-label="上传图片到画布"]',
      )?.disabled,
  );
  await canvasSurface.locator('input[type="file"]').setInputFiles([
    { name: "Docker batch 1.png", mimeType: "image/png", buffer: uploadPng },
    { name: "Docker batch 2.png", mimeType: "image/png", buffer: uploadPng },
  ]);
  await page
    .locator('.react-flow__node-image img[alt="Docker batch 2.png"]')
    .waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>(
        'button[aria-label="上传图片到画布"]',
      )?.disabled,
  );
  const batchAssetIds = await page
    .locator('.react-flow__node-image img[alt^="Docker batch "]')
    .evaluateAll((images) =>
      images.map((image) => image.getAttribute("src")!.split("/")[4]),
    );
  assert.equal(batchAssetIds.length, 2);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:8792",
  });
  await page.evaluate(async (encoded) => {
    const blob = new Blob(
      [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
      { type: "image/png" },
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, uploadPng.toString("base64"));
  await canvasSurface.focus();
  const screenshotResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/images/uploads") &&
      response.request().method() === "POST",
  );
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+v`,
  );
  const screenshotAssetId = (await (await screenshotResponse).json()).id;
  await page
    .locator(
      `.react-flow__node-image img[src="/api/images/assets/${screenshotAssetId}/preview"]`,
    )
    .waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>(
        'button[aria-label="上传图片到画布"]',
      )?.disabled,
  );
  await page
    .getByLabel("创作需求", { exact: true })
    .fill("Synthetic generation feedback acceptance");
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  await page.waitForFunction(() => {
    const button = document.querySelector(
      ".direct-creation .generation-submit-row > .primary",
    );
    return (
      button?.getAttribute("aria-busy") === "true" &&
      getComputedStyle(button).backgroundColor === "rgb(0, 98, 176)"
    );
  });
  assert.equal(
    await page
      .locator(".direct-creation .generation-submit-row > .primary")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(0, 98, 176)",
  );
  await page.getByRole("status", { name: "图片生成状态" }).waitFor();
  await page.getByText("已生成 1 张", { exact: true }).waitFor();
  await page.screenshot({
    path: ".codex-temp/docker-generation-feedback.png",
    animations: "disabled",
  });
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  const completed = await (
    await page.request.get(
      `http://127.0.0.1:8792/api/images/tasks?projectId=${projectId}`,
    )
  ).json();
  const expectedAssets = [
    uploadedAssetId,
    ...batchAssetIds,
    screenshotAssetId,
    ...completed.tasks.flatMap((task: any) =>
      task.outputs.map((output: any) => output.id),
    ),
  ] as string[];
  await page.waitForFunction((ids) => {
    const sources = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        ".react-flow__node-image img",
      ),
      (image) => image.getAttribute("src"),
    );
    return (
      ids.length > 0 &&
      sources.length === ids.length &&
      ids.every((id) => sources.includes(`/api/images/assets/${id}/preview`))
    );
  }, expectedAssets);
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await page
    .locator(".canvas-status")
    .filter({ hasText: "画布已保存" })
    .waitFor();
  const positioned = (
    await (
      await page.request.get(
        `http://127.0.0.1:8792/api/projects/${projectId}/canvas`,
      )
    ).json()
  ).document.nodes;
  for (let i = 0; i < positioned.length; i++)
    for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i],
        b = positioned[j];
      assert(
        a.x >= b.x + b.width + 24 ||
          b.x >= a.x + a.width + 24 ||
          a.y >= b.y + b.height + 24 ||
          b.y >= a.y + a.height + 24,
      );
    }
  const nodeCount = await page.locator(".react-flow__node-image").count();
  assert(nodeCount > 0);
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".react-flow__node-image").length === count,
    nodeCount * 2,
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".react-flow__node-image").length === count,
    nodeCount,
  );
  await page
    .locator(".canvas-status")
    .filter({ hasText: "画布已保存" })
    .waitFor();
  const session = await (
    await page.request.get("http://127.0.0.1:8792/api/auth/me")
  ).json();
  async function command(path: string, data: unknown) {
    const response = await page.request.post(
      `http://127.0.0.1:8792/api${path}`,
      {
        headers: {
          Origin: "http://127.0.0.1:8792",
          "X-CSRF-Token": session.csrfToken,
        },
        data,
      },
    );
    assert(response.ok(), `SYNTHETIC_COMMAND_HTTP_${response.status()}`);
    return response.json();
  }
  await command("/image-admin/planning-providers", {
    mode: "fake",
    baseUrl: "",
    model: "docker-synthetic-planner",
  });
  const assets = await (
    await page.request.get(
      `http://127.0.0.1:8792/api/images/tasks?projectId=${projectId}`,
    )
  ).json();
  // Exercise the mature image overlay under the built application's strict CSP.
  await page
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  await page.locator(".output-grid .ant-image").first().click();
  await page.locator(".ant-image-preview").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".ant-image-preview").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "任务详情", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "复用设置", exact: true })
    .first()
    .click();
  // Reuse replaces the retained creation draft and requires explicit confirmation.
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .waitFor({ state: "hidden" });
  assert(
    (await page.getByLabel("创作需求", { exact: true }).inputValue()).length >
      0,
  );
  await page
    .locator(".canvas-task-history > .ant-collapse-item > .ant-collapse-header")
    .click();
  const referenceId = assets.tasks.flatMap((task: any) => task.outputs)[0].id;
  const spec = {
    prompt: "Synthetic product composition",
    model: "test-image",
    width: 256,
    height: 256,
    quality: "medium",
    format: "png",
    referenceIds: [referenceId],
  };
  const job = await command("/agent/planning", {
    ...spec,
    projectId,
    requestKey: randomUUID(),
  });
  for (let i = 0; i < 40; i++) {
    const result = await (
      await page.request.get(
        `http://127.0.0.1:8792/api/agent/jobs?projectId=${projectId}`,
      )
    ).json();
    if (
      result.jobs.find((item: any) => item.id === job.id)?.state === "succeeded"
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await command(`/agent/jobs/${job.id}/revisions`, {
    requestKey: randomUUID(),
    document: {
      message: "Synthetic two-step review",
      steps: [
        {
          ...spec,
          title: "Product composition",
          count: 2,
          tool: { id: "image.edit", version: 1 },
          usePrevious: false,
        },
        {
          ...spec,
          title: "Product detail",
          count: 1,
          tool: { id: "image.edit", version: 1 },
          usePrevious: true,
        },
      ],
    },
  });
  await page.reload();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.getByLabel("计划步骤摘要").waitFor();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `.codex-temp/docker-agent-review-${viewport.width}-before.png`,
      animations: "disabled",
    });
    await page
      .waitForFunction(() => {
        const card = document
          .querySelector(".agent-plan-form")
          ?.getBoundingClientRect();
        const conversation = document
          .querySelector(".agent-conversation")
          ?.getBoundingClientRect();
        return (
          card &&
          conversation &&
          card.top >= conversation.top - 1 &&
          card.bottom <= conversation.bottom + 1
        );
      })
      .catch(async (error) => {
        console.log(
          "PLAN_REVIEW_GEOMETRY",
          await page.evaluate(() =>
            [".agent-plan-form", ".agent-conversation"].map((selector) => {
              const box = document
                .querySelector(selector)
                ?.getBoundingClientRect();
              return {
                selector,
                top: box?.top,
                bottom: box?.bottom,
                height: box?.height,
              };
            }),
          ),
        );
        throw error;
      });
    const confirm = await page
      .getByRole("button", { name: "确认执行", exact: true })
      .boundingBox();
    assert(confirm && confirm.y + confirm.height <= viewport.height);
    assert.equal(
      await page.getByLabel("计划步骤摘要").locator("li").count(),
      2,
    );
    await page.screenshot({
      path: `.codex-temp/docker-agent-review-${viewport.width}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "继续聊想法", exact: true }).click();
  await page.getByLabel("告诉 Agent 你的想法", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "直接创作", exact: true }).click();
  assert.equal(
    await page.getByLabel("图片模型", { exact: true }).isEnabled(),
    false,
  );
  await page.screenshot({
    path: ".codex-temp/docker-stage2-workbench.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await page.getByLabel("搜索用户", { exact: true }).fill(auth.username);
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: auth.username, exact: true }),
    })
    .getByRole("button", { name: "管理", exact: true })
    .click();
  const ownDrawer = page.getByRole("dialog", {
    name: new RegExp(auth.username),
  });
  assert.equal(
    await ownDrawer
      .getByRole("button", { name: "更多账号操作", exact: true })
      .count(),
    0,
  );
  const quotaInput = ownDrawer.getByLabel("每日图片额度", { exact: true });
  const originalQuota = await quotaInput.inputValue();
  await quotaInput.fill(String(Number(originalQuota) + 1));
  await ownDrawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("dialog", { name: "请确认", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(
    await quotaInput.inputValue(),
    String(Number(originalQuota) + 1),
  );
  await quotaInput.fill(originalQuota);
  await ownDrawer.getByRole("button", { name: "关闭", exact: true }).click();
  await ownDrawer.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("link", { name: "图库", exact: true }).click();
  await page.getByRole("heading", { name: "我的图库", exact: true }).waitFor();
  await page.locator(".gallery-card").first().getByRole("checkbox").check();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出所选 ZIP", exact: true }).click();
  assert.equal((await downloadReady).suggestedFilename(), "tuyile-images.zip");
  await page.screenshot({
    path: ".codex-temp/docker-gallery-1920.png",
    animations: "disabled",
  });
  await page.getByRole("link", { name: "提示池", exact: true }).click();
  await page.getByRole("heading", { name: "提示池", exact: true }).waitFor();
  await page
    .locator(".prompt-card")
    .first()
    .getByRole("button", { name: "收藏提示词", exact: true })
    .click();
  await page
    .locator(".prompt-card")
    .first()
    .getByRole("button", { name: "已收藏提示词", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "模型服务", exact: true }).click();
  await page.getByRole("tab", { name: "运行与核验", exact: true }).click();
  await page
    .getByRole("heading", { name: "运行概览与规划策略", exact: true })
    .waitFor();
  await page
    .getByText("图片统计日、逐单预留和规划计次对账一致。", { exact: true })
    .waitFor();
  await page.getByLabel("每日规划次数", { exact: true }).waitFor();
  await page.locator(".operations-admin").screenshot({
    path: ".codex-temp/docker-administration.png",
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Built Docker Chromium: anchored temporary/pinned creation panel, canvas batch upload/layout/drop/screenshot paste/reference and keyboard copy/paste/undo, nonce styles, themed button, singleton model lock, confirmation dialog and medium/large desktop layout passed",
  );
} finally {
  await browser.close();
}
