import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
export async function verifyTextCanvas(page: Page) {
  const origin = new URL(page.url());
  if (
    origin.hostname !== "127.0.0.1" ||
    !["5180", "8792"].includes(origin.port)
  )
    throw new Error("REFUSE_NON_SYNTHETIC_BROWSER_TARGET");
  const apiUrl = (path: string) => new URL(path, origin).toString();
  await page.goto(new URL("/projects", page.url()).toString());
  const name = `文案验收-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name, exact: true }).click();
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  const editor = canvas.getByRole("textbox", { name: "文案正文", exact: true });
  await editor.fill("山间开业，慢慢相遇。\n<b>按纯文本保留</b>");
  await editor.press("Enter");
  await editor.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);
  const title = canvas.getByRole("button", {
    name: "重命名文案：文案",
    exact: true,
  });
  await title.dblclick();
  await canvas.getByLabel("文案标题", { exact: true }).fill("海报主标题");
  await canvas.getByLabel("文案标题", { exact: true }).press("Enter");
  await canvas
    .getByRole("button", { name: "引用到当前创作", exact: true })
    .click();
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await editor.fill("一杯拿铁，一段山间时光。");
  await editor.press("ControlOrMeta+Enter");
  await canvas
    .getByRole("button", { name: "引用到当前创作", exact: true })
    .click();
  const refs = page.getByRole("region", { name: "引用文案", exact: true });
  // section has an accessible name and is shared by the active creation form.
  await expect(refs).toContainText("引用文案 · 2");
  await page
    .getByLabel("创作需求", { exact: true })
    .fill("做一张咖啡海报，采用引用文案。");
  const unintended: string[] = [];
  const track = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      /\/api\/(images\/tasks|agent\/planning)$/.test(request.url())
    )
      unintended.push(request.url());
  };
  page.on("request", track);
  await refs.getByRole("button", { name: "上移文案 2", exact: true }).click();
  await refs.getByRole("button", { name: "下移文案 1", exact: true }).click();
  await refs.getByRole("button", { name: "上移文案 2", exact: true }).click();
  await refs.getByRole("button", { name: "移除文案 2", exact: true }).click();
  await refs.getByRole("button", { name: "从画布选择", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "从画布选择文案",
    exact: true,
  });
  await expect(
    picker.getByRole("checkbox", { name: "海报主标题", exact: true }),
  ).not.toBeChecked();
  await picker
    .getByRole("checkbox", { name: "海报主标题", exact: true })
    .check();
  await picker.getByRole("button", { name: /确定/ }).click();
  await refs.getByText("查看组合后的创作需求", { exact: true }).click();
  await expect(refs.locator(".text-prompt-preview")).toContainText(
    "引用文案 1（文案）：\n一杯拿铁",
  );
  await expect(canvas.locator(".canvas-text-card b")).toHaveCount(0);
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(apiUrl(`/api/projects/${projectId}/draft`))
          ).json()
        ).document.textNodeIds?.length,
    )
    .toBe(2);
  const saved = await (
    await page.request.get(apiUrl(`/api/projects/${projectId}/canvas`))
  ).json();
  expect(
    saved.document.nodes.filter((n: { kind: string }) => n.kind === "text"),
  ).toHaveLength(2);
  const [a, b] = saved.document.nodes;
  expect(
    a.x + a.width <= b.x ||
      a.y + a.height <= b.y ||
      b.x + b.width <= a.x ||
      b.y + b.height <= a.y,
  ).toBe(true);
  expect(unintended).toEqual([]);
  page.off("request", track);
  await page.reload();
  await expect(canvas.locator(".canvas-text-card")).toHaveCount(2);
  await expect(refs).toContainText("引用文案 · 2");
  // Text editing preserves native selection and textarea undo.
  await canvas.locator(".canvas-text-body").first().dblclick();
  await editor.press("ControlOrMeta+A");
  expect(
    await editor.evaluate(
      (el) =>
        (el as HTMLTextAreaElement).selectionEnd -
        (el as HTMLTextAreaElement).selectionStart,
    ),
  ).toBeGreaterThan(4);
  await editor.fill("更新后的标题");
  await editor.press("ControlOrMeta+Enter");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(canvas.locator(".canvas-text-body").first()).toContainText(
    "山间开业",
  );
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(canvas.locator(".canvas-text-body").first()).toContainText(
    "更新后的标题",
  );
  await page
    .getByRole("textbox", { name: "创作需求", exact: true })
    .fill("做一张咖啡海报，采用引用文案。");
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/images/tasks") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBe(true);
  const task = await response.json();
  expect(task.textSources.map((s: { text: string }) => s.text)).toEqual([
    "一杯拿铁，一段山间时光。",
    "更新后的标题",
  ]);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(apiUrl(`/api/images/tasks/${task.id}`))
          ).json()
        ).state,
      { timeout: 20000 },
    )
    .toBe("succeeded");
  await expect(
    canvas.locator(".react-flow__edge-text").filter({ hasText: "文案" }),
  ).toHaveCount(2);
  expect(
    await canvas
      .locator(".canvas-text-card .canvas-text-header")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await canvas.focus();
  await canvas.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "分组", exact: true }).click();
  await expect(canvas.locator(".canvas-group")).toHaveCount(1);
  await page.getByRole("button", { name: "解除分组", exact: true }).click();
  await expect(canvas.locator(".canvas-group")).toHaveCount(0);
  // Copy and delete operate on cards, while missing references remain explicit.
  await canvas.focus();
  await canvas.press("ControlOrMeta+A");
  await canvas.press("ControlOrMeta+D");
  await expect(canvas.locator(".canvas-text-card")).toHaveCount(4);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(canvas.locator(".canvas-text-card")).toHaveCount(2);
  await canvas.focus();
  await canvas.press("ControlOrMeta+A");
  await canvas.press("Delete");
  await expect(canvas.locator(".canvas-text-card")).toHaveCount(0);
  await expect(refs).toContainText("引用文案已删除或内容为空");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(canvas.locator(".canvas-text-card")).toHaveCount(2);
  // The same links guide Agent planning; confirmation uses the frozen planning snapshot.
  const session = await (await page.request.get(apiUrl("/api/auth/me"))).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrfToken,
  };
  const configured = await page.request.post(
    apiUrl("/api/image-admin/planning-providers"),
    {
      headers,
      data: { mode: "fake", baseUrl: "", model: "text-canvas-planner" },
    },
  );
  expect(configured.ok()).toBe(true);
  await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
  const agentRefs = page.getByRole("region", { name: "引用文案", exact: true });
  await expect(agentRefs).toContainText("引用文案 · 2");
  await page
    .getByLabel("告诉 Agent 你的想法", { exact: true })
    .fill("用引用文案设计咖啡海报，直接给出一个方案。");
  unintended.length = 0;
  page.on("request", track);
  await agentRefs
    .getByRole("button", { name: "从画布选择", exact: true })
    .click();
  await picker.getByRole("button", { name: /取消/ }).click();
  await expect(
    page.getByRole("button", { name: "生成计划", exact: true }),
  ).toBeEnabled();
  expect(unintended).toEqual([]);
  page.off("request", track);
  const planning = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/agent/planning") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  const planned = await planning;
  expect(planned.ok()).toBe(true);
  const job = await planned.json();
  expect(job.textSources).toEqual(task.textSources);
  await page.getByRole("button", { name: "确认执行", exact: true }).waitFor();
  await canvas.locator(".canvas-text-body").first().dblclick();
  await editor.fill("下一次才使用的新文案");
  await editor.press("ControlOrMeta+Enter");
  const confirming = page.waitForResponse(
    (r) =>
      /\/api\/agent\/plans\/[^/]+\/confirm$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  const confirmed = await confirming;
  expect(confirmed.ok()).toBe(true);
  const { tasks: confirmedTasks } = await confirmed.json();
  expect(confirmedTasks[0].textSources).toEqual(task.textSources);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              apiUrl(`/api/images/tasks/${confirmedTasks[0].id}`),
            )
          ).json()
        ).state,
      { timeout: 20000 },
    )
    .toBe("succeeded");
  await page.screenshot({
    path: ".codex-temp/text-canvas-acceptance.png",
    animations: "disabled",
  });
}
