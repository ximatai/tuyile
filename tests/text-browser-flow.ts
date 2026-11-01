import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function createProject(page: Page) {
  const origin = new URL(page.url());
  if (
    origin.hostname !== "127.0.0.1" ||
    !["5180", "8792"].includes(origin.port)
  )
    throw new Error("REFUSE_NON_SYNTHETIC_BROWSER_TARGET");
  const apiUrl = (path: string) => new URL(path, origin).toString();
  await page.goto(new URL("/projects", page.url()).toString());
  const name = `文案验收-${randomUUID().slice(0, 8)}`;
  await page.getByRole("textbox", { name: "项目名称", exact: true }).fill(name);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name, exact: true }).click();

  return { origin, apiUrl, name };
}
async function createNote(page: Page) {
  const project = await createProject(page);
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  const editor = canvas.getByRole("textbox", { name: "文案正文", exact: true });
  await editor.fill("山间开业，慢慢相遇。\n<b>按纯文本保留</b>");
  await editor.press("Enter");
  await editor.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);

  return { ...project, canvas, editor };
}
export async function verifyProjectSidebar(page: Page) {
  const { origin, apiUrl, name } = await createProject(page);
  const initialSession = await (
    await page.request.get(apiUrl("/api/auth/me"))
  ).json();
  const projectHeaders = {
    Origin: origin.origin,
    "X-CSRF-Token": initialSession.csrfToken,
  };
  const longProjectName =
    "侧边栏长项目名称验收：山间咖啡品牌文案与视觉创作素材编排";
  for (let index = 0; index < 12; index++) {
    const result = await page.request.post(apiUrl("/api/projects"), {
      headers: projectHeaders,
      data: { name: `${longProjectName} ${index + 1}` },
    });
    expect(result.ok()).toBe(true);
  }
  await page.reload();
  await page.getByRole("link", { name, exact: true }).click();
  const initialViewport = page.viewportSize()!;
  await page.setViewportSize({ width: initialViewport.width, height: 720 });
  const projectLinks = page.locator(".sidebar-projects a");
  await expect(projectLinks.filter({ hasText: longProjectName })).toHaveCount(
    12,
  );
  const dimensions = await projectLinks.evaluateAll((links) =>
    links.map((link) => ({
      height: link.getBoundingClientRect().height,
      scroll: link.scrollHeight,
      client: link.clientHeight,
    })),
  );
  expect(
    dimensions.every((item) => item.height >= 32 && item.scroll <= item.client),
  ).toBe(true);
  expect(
    await page
      .locator(".sidebar-projects")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  expect(
    await projectLinks
      .filter({ hasText: longProjectName })
      .first()
      .getAttribute("title"),
  ).toContain(longProjectName);
  await page.setViewportSize(initialViewport);
}
export async function verifyTextControls(page: Page) {
  const { canvas } = await createNote(page);
  const palette = canvas.locator(".canvas-tone-picker");
  await expect(palette.getByRole("radio")).toHaveCount(5);
  await palette
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: "浅粉", exact: true }) })
    .click();
  await expect(canvas.locator(".canvas-text-card.tone-pink")).toHaveCount(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    palette.getByRole("radio", { name: "浅黄", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    palette.getByRole("radio", { name: "浅粉", exact: true }),
  ).toBeChecked();
  await palette
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: "浅蓝", exact: true }) })
    .click();
  await palette
    .getByRole("radio", { name: "浅蓝", exact: true })
    .press("ArrowRight");
  await expect(
    palette.getByRole("radio", { name: "浅绿", exact: true }),
  ).toBeChecked();
  const referenceIcon = canvas.getByRole("button", {
    name: "引用到当前创作",
    exact: true,
  });
  expect(await referenceIcon.textContent()).toBe("");
  const iconBox = (await referenceIcon.boundingBox())!;
  expect(iconBox.width).toBeLessThanOrEqual(36);
  expect(iconBox.height).toBeLessThanOrEqual(36);

  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  for (const edge of ["top", "left", "right", "bottom"]) {
    const preview = await page.context().newPage();
    try {
      await preview.setViewportSize(page.viewportSize()!);
      await preview.route("**/api/**", async (route) => {
        if (route.request().method() === "POST") {
          await route.abort();
          return;
        }
        if (route.request().url().endsWith("/canvas")) {
          const response = await route.fetch();
          const body = await response.json();
          const node = body.document.nodes[0];
          const canvasWidth = (await canvas
            .locator(".react-flow")
            .boundingBox())!.width;
          body.document = {
            ...body.document,
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [
              {
                ...node,
                x:
                  edge === "left"
                    ? 20 - node.width
                    : edge === "right"
                      ? canvasWidth - 20
                      : 80,
                y:
                  edge === "bottom"
                    ? (await canvas.locator(".react-flow").boundingBox())!
                        .height - 20
                    : 0,
              },
            ],
          };
          await route.fulfill({ response, json: body });
          return;
        }
        await route.continue();
      });
      await preview.goto(page.url());
      const surface = preview.getByRole("region", {
        name: "项目画布",
        exact: true,
      });
      const node = surface.locator(".react-flow__node-text");
      const width = (await node.boundingBox())!.width;
      await node.click({
        position: {
          x: edge === "left" ? width - 6 : 6,
          y: edge === "bottom" ? 6 : 80,
        },
      });
      const action = surface.getByRole("button", {
        name: "引用到当前创作",
        exact: true,
      });
      await action.click({ trial: true });
      const bounds = (await surface.locator(".react-flow").boundingBox())!;
      const button = (await action.boundingBox())!;
      expect(button.x).toBeGreaterThanOrEqual(bounds.x);
      expect(button.y).toBeGreaterThanOrEqual(bounds.y);
      expect(button.x + button.width).toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
      expect(button.y + button.height).toBeLessThanOrEqual(
        bounds.y + bounds.height,
      );
    } finally {
      await preview.close();
    }
  }
}
async function prepareReferences(page: Page) {
  const { apiUrl, canvas, editor } = await createNote(page);
  const title = canvas.getByRole("button", {
    name: "重命名文案：文案",
    exact: true,
  });
  await title.dblclick();
  await canvas.getByLabel("文案标题", { exact: true }).fill("海报主标题");
  await canvas.getByLabel("文案标题", { exact: true }).press("Enter");
  await canvas.locator(".canvas-text-card").last().hover();
  await canvas
    .getByRole("toolbar", { name: "文案操作", exact: true })
    .last()
    .getByRole("button", { name: "引用到当前创作", exact: true })
    .click();
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await editor.fill("一杯拿铁，一段山间时光。");
  await editor.press("ControlOrMeta+Enter");
  await canvas.locator(".canvas-text-card").last().hover();
  await canvas
    .getByRole("toolbar", { name: "文案操作", exact: true })
    .last()
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
  await refs.locator(".text-reference-item").nth(1).hover();
  await refs.getByRole("button", { name: "上移文案 2", exact: true }).click();
  await refs.locator(".text-reference-item").nth(0).hover();
  await refs.getByRole("button", { name: "下移文案 1", exact: true }).click();
  await refs.locator(".text-reference-item").nth(1).hover();
  await refs.getByRole("button", { name: "上移文案 2", exact: true }).click();
  await refs.locator(".text-reference-item").nth(1).hover();
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
  await page.mouse.move(220, 80);
  expect(
    await refs
      .locator(".text-reference-actions")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("0");
  expect(
    (await refs.locator(".text-reference-item").first().boundingBox())!.height,
  ).toBeLessThan(80);
  await refs.getByRole("button", { name: "展开文案 1", exact: true }).click();
  await expect(refs.locator(".text-reference-full")).toContainText(
    "一杯拿铁，一段山间时光。",
  );
  await refs.getByRole("button", { name: "收起文案 1", exact: true }).click();
  await refs.getByRole("button", { name: "展开文案 1", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    refs.getByRole("button", { name: "下移文案 1", exact: true }),
  ).toBeFocused();
  expect(
    await refs
      .locator(".text-reference-actions")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("1");
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
  return {
    apiUrl,
    canvas,
    editor,
    refs,
    picker,
    unintended,
    track,
    saved,
    projectId,
  };
}
function referenceConflictHelpers(
  page: Page,
  canvas: ReturnType<Page["locator"]>,
  editor: ReturnType<Page["locator"]>,
) {
  async function editFromOtherTab(text: string) {
    await expect(page.locator(".canvas-status")).toContainText("画布已保存");
    const other = await page.context().newPage();
    try {
      await other.goto(page.url());
      const surface = other.getByRole("region", {
        name: "项目画布",
        exact: true,
      });
      await surface.locator(".react-flow__controls-fitview").click();
      await surface.locator(".canvas-text-body").first().dblclick();
      await surface.getByLabel("文案正文", { exact: true }).fill(text);
      await surface
        .getByLabel("文案正文", { exact: true })
        .press("ControlOrMeta+Enter");
      await expect(other.locator(".canvas-status")).toContainText("画布已保存");
    } finally {
      await other.close();
    }
  }
  async function reloadPreview() {
    await canvas.getByRole("button", { name: "重新加载", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "请确认", exact: true });
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(
      canvas.getByRole("button", { name: "重新加载", exact: true }),
    ).toHaveCount(0);
  }

  return { editFromOtherTab, reloadPreview };
}
export async function verifyDirectTextCreation(page: Page) {
  const { apiUrl, canvas, editor, refs, projectId } =
    await prepareReferences(page);
  const { editFromOtherTab, reloadPreview } = referenceConflictHelpers(
    page,
    canvas,
    editor,
  );
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

  const directLatest = "另一个页面更新后的标题";
  await editFromOtherTab(directLatest);
  await expect(canvas.locator(".canvas-text-body").first()).toContainText(
    "更新后的标题",
  );
  const rejectedDirect = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/images/tasks") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交图片任务", exact: true }).click();
  const staleDirect = await rejectedDirect;
  expect(staleDirect.status()).toBe(409);
  expect((await staleDirect.json()).error.code).toBe("TEXT_REFERENCE_CONFLICT");
  expect(
    (
      await (
        await page.request.get(
          apiUrl(`/api/images/tasks?projectId=${projectId}`),
        )
      ).json()
    ).tasks,
  ).toHaveLength(0);
  await reloadPreview();
  await expect(canvas.locator(".canvas-text-body").first()).toContainText(
    directLatest,
  );
  await expect(page.getByLabel("创作需求", { exact: true })).toHaveValue(
    "做一张咖啡海报，采用引用文案。",
  );
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
    directLatest,
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
  await refs.locator(".text-reference-title").first().click();
  await expect(canvas.locator(".react-flow__edge.lineage-active")).toHaveCount(
    1,
  );
  await expect(canvas.locator(".react-flow__node.lineage-muted")).toHaveCount(
    1,
  );
  await canvas
    .locator(".react-flow__node-image")
    .first()
    .click({ position: { x: 6, y: 60 } });
  await expect(canvas.locator(".react-flow__edge.lineage-active")).toHaveCount(
    2,
  );
  await expect(canvas.locator(".react-flow__node.lineage-muted")).toHaveCount(
    0,
  );
  await canvas.focus();
  await canvas.press("Escape");
  await expect(canvas.locator(".lineage-active,.lineage-muted")).toHaveCount(0);
  await page.screenshot({
    path: ".codex-temp/compact-copy-acceptance.png",
    animations: "disabled",
  });

  for (const [kind, label] of [
    ["text", "文案操作"],
    ["image", "图片操作"],
  ]) {
    const node = canvas.locator(`.react-flow__node-${kind}`).first();
    const actions = canvas
      .getByRole("toolbar", { name: label, exact: true })
      .first();
    const flow = (await canvas.locator(".react-flow").boundingBox())!;
    const leave = async () => {
      await canvas.focus();
      await page.mouse.move(
        flow.x + flow.width - 30,
        flow.y + flow.height - 120,
      );
      await expect(actions).toHaveCSS("opacity", "0");
    };
    await leave();
    await node.hover();
    await expect(actions).toHaveCSS("opacity", "1");
    const card = (await node.boundingBox())!,
      bar = (await actions.boundingBox())!;
    expect(bar.y).toBeGreaterThanOrEqual(card.y + card.height);
    expect(bar.x + bar.width).toBeLessThanOrEqual(card.x + card.width);
    await page.mouse.move(card.x + card.width - 10, card.y + card.height + 4);
    await actions.hover();
    await expect(actions).toHaveCSS("opacity", "1");
    await leave();
    await node.focus();
    await page.keyboard.press("Tab");
    await expect(actions).toHaveCSS("opacity", "1");
    await leave();
  }
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
}
export async function verifyAgentTextCreation(page: Page) {
  const {
    apiUrl,
    canvas,
    editor,
    picker,
    unintended,
    track,
    saved,
    projectId,
  } = await prepareReferences(page);
  const { editFromOtherTab, reloadPreview } = referenceConflictHelpers(
    page,
    canvas,
    editor,
  );
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

  const agentLatest = "Agent 发送前的最新标题";
  await editFromOtherTab(agentLatest);
  const rejectedAgent = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/agent/planning") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  const staleAgent = await rejectedAgent;
  expect(staleAgent.status()).toBe(409);
  expect((await staleAgent.json()).error.code).toBe("TEXT_REFERENCE_CONFLICT");
  expect(
    (
      await (
        await page.request.get(apiUrl(`/api/agent/jobs?projectId=${projectId}`))
      ).json()
    ).jobs,
  ).toHaveLength(0);
  await reloadPreview();
  await expect(canvas.locator(".canvas-text-body").first()).toContainText(
    agentLatest,
  );
  await expect(
    page.getByLabel("告诉 Agent 你的想法", { exact: true }),
  ).toHaveValue("用引用文案设计咖啡海报，直接给出一个方案。");
  const planning = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/agent/planning") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成计划", exact: true }).click();
  const planned = await planning;
  expect(planned.ok()).toBe(true);
  const job = await planned.json();
  const latestSources = [saved.document.nodes[1], saved.document.nodes[0]]
    .map((n: { id: string; label: string; text: string }) => ({
      nodeId: n.id,
      title: n.label,
      text: n.text,
    }))
    .map((source: { nodeId: string; text: string }) =>
      source.nodeId === saved.document.nodes[0].id
        ? { ...source, text: agentLatest }
        : source,
    );
  expect(job.textSources).toEqual(latestSources);
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
  expect(confirmedTasks[0].textSources).toEqual(latestSources);
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
/** Same independent scenarios against the built Docker environment. */
export async function verifyTextCanvas(page: Page) {
  for (const [name, verify] of [
    ["sidebar", verifyProjectSidebar],
    ["text controls", verifyTextControls],
    ["direct text creation", verifyDirectTextCreation],
    ["Agent text creation", verifyAgentTextCreation],
  ] as const) {
    await verify(page);
    console.log(`Docker text scenario passed: ${name}`);
  }
}
