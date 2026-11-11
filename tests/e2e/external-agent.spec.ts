import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loginAdmin } from "./admin-session";

test("opens the current canvas from the Codex handoff and manages project access", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await loginAdmin(page);
  const { csrfToken } = await (await page.request.get("/api/auth/me")).json();
  const created = await page.request.post("/api/projects", {
    headers: { Origin: baseURL!, "X-CSRF-Token": csrfToken },
    data: { name: "Codex 合成验收" },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await page.goto(`/projects/${id}`);
  await page.getByRole("button", { name: "在 Codex 中继续" }).click();
  const dialog = page.getByRole("dialog", { name: "在 Codex 中继续" });
  await expect(
    dialog.getByRole("heading", { name: "授权 Codex 访问此项目" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "签发令牌并继续" }).click();
  await expect(dialog.getByLabel("Codex MCP 配置")).toHaveValue(
    new RegExp(`${baseURL}/mcp`),
  );
  await expect(dialog.getByLabel("Codex MCP 配置")).toHaveValue(
    new RegExp(`tuyile_${id.replaceAll("-", "")}`),
  );
  const token = await dialog.getByLabel("项目访问令牌").inputValue();
  expect(token).toMatch(/^tuyile_/);
  const call = (token: string, name: string, args: object = {}) =>
    page.request.post("/mcp", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: { projectUrl: `${baseURL}/projects/${id}`, ...args },
        },
      },
    });
  await dialog.getByRole("button", { name: "继续验证" }).click();
  await dialog.getByRole("button", { name: "检查连接" }).click();
  await expect(dialog.getByText(/还未收到读取请求/)).toBeVisible();
  expect(
    (await (await call(token, "read_canvas")).json()).result.structuredContent,
  ).toMatchObject({
    projectId: id,
    revision: 0,
  });
  await dialog.getByRole("button", { name: "检查连接" }).click();
  await expect(
    dialog.getByRole("heading", { name: "此项目已验证连接" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "复制给 Codex" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain(`${baseURL}/projects/${id}`);
  expect(prompt).not.toContain(token);
  await dialog.getByRole("button", { name: "配置与令牌管理" }).click();
  await dialog.getByRole("button", { name: "更换权限或令牌" }).click();
  await dialog.getByRole("button", { name: "替换令牌并继续" }).click();
  await expect(
    dialog.getByText("已签发 · 待验证", { exact: true }),
  ).toBeVisible();
  expect((await call(token, "read_canvas")).status()).toBe(401);
  await dialog.getByRole("button", { name: "撤销令牌" }).click();
  await expect(
    dialog.getByRole("heading", { name: "授权 Codex 访问此项目" }),
  ).toBeVisible();
  expect((await call(token, "read_canvas")).status()).toBe(401);
  await dialog.getByRole("checkbox", { name: "允许编辑画布" }).check();
  await dialog.getByRole("button", { name: "签发令牌并继续" }).click();
  const writableToken = await dialog.getByLabel("项目访问令牌").inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  const id1 = randomUUID();
  const note = {
    id: id1,
    x: 70,
    y: 90,
    width: 180,
    height: 100,
    label: "远程标题",
    text: "远程文案",
  };
  const edit = async (revision: number, operations: object[]) =>
    (
      await (
        await call(writableToken, "edit_canvas", {
          revision,
          requestKey: randomUUID(),
          operations,
        })
      ).json()
    ).result;
  expect(await edit(0, [{ action: "add_text", node: note }])).toMatchObject({
    structuredContent: { revision: 1 },
  });
  await expect(page.getByText("远程文案", { exact: true })).toBeVisible();
  await expect(page.locator(".canvas-status")).toContainText("v1");

  await page.getByText("远程标题", { exact: true }).dblclick();
  const title = page.getByRole("textbox", { name: "文案标题" });
  await title.fill("本地尚未提交的标题");
  expect(
    await edit(1, [{ action: "move_node", nodeId: id1, x: 130, y: 90 }]),
  ).toMatchObject({
    structuredContent: { revision: 2 },
  });
  await expect(title).toHaveValue("本地尚未提交的标题");
  await title.press("Enter");
  await expect(
    page.getByText("本地尚未提交的标题", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "另存当前修改" }),
  ).toBeVisible();
  const serverCanvas = await (
    await page.request.get(`/api/projects/${id}/canvas`)
  ).json();
  expect(serverCanvas).toMatchObject({
    revision: 2,
    document: { nodes: [{ label: "远程标题", x: 130 }] },
  });
});

test("generates three project images through MCP and places them once on an open canvas", async ({
  page,
  baseURL,
}) => {
  await loginAdmin(page);
  const { csrfToken } = await (await page.request.get("/api/auth/me")).json();
  const headers = { Origin: baseURL!, "X-CSRF-Token": csrfToken };
  const project = await page.request.post("/api/projects", {
    headers,
    data: { name: "外部 Agent 生图验收" },
  });
  expect(project.ok()).toBe(true);
  const { id } = await project.json();
  const png = await (
    await import("sharp")
  )
    .default({
      create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
    })
    .png()
    .toBuffer();
  const uploaded = await page.request.post("/api/images/uploads", {
    headers: { ...headers, "Content-Type": "image/png" },
    data: png,
  });
  expect(uploaded.ok()).toBe(true);
  const source = await uploaded.json();
  const original = {
    id: randomUUID(),
    assetId: source.id,
    kind: "image",
    x: 80,
    y: 60,
    width: 128,
    height: 128,
    label: "商品原图",
  };
  const saved = await page.request.post(`/api/projects/${id}/canvas`, {
    headers,
    data: {
      requestKey: randomUUID(),
      revision: 0,
      placements: [],
      document: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [original],
      },
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto(`/projects/${id}`);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await page.getByRole("button", { name: "在 Codex 中继续" }).click();
  const dialog = page.getByRole("dialog", { name: "在 Codex 中继续" });
  await dialog.getByRole("checkbox", { name: "允许编辑画布" }).check();
  await dialog
    .getByRole("checkbox", { name: "允许提交生图", exact: false })
    .check();
  await dialog.getByRole("button", { name: "签发令牌并继续" }).click();
  const token = await dialog.getByLabel("项目访问令牌").inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  async function call(name: string, args: object = {}) {
    const response = await page.request.post("/mcp", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: { projectUrl: `${baseURL}/projects/${id}`, ...args },
        },
      },
    });
    expect(response.ok()).toBe(true);
    const { result } = await response.json();
    expect(result.isError, result.content?.[0]?.text).not.toBe(true);
    return result.structuredContent;
  }
  const snapshot = await call("read_canvas");
  expect(snapshot.nodes[0].assetId).toBe(source.id);
  const options = await call("image_options");
  expect(options.models).toContain("test-image");
  const request = {
    requestKey: randomUUID(),
    model: "test-image",
    prompt: "为商品合成三张背景图",
    width: 256,
    height: 256,
    quality: "medium",
    format: "png",
    count: 3,
    referenceIds: [source.id],
  };
  const queued = await call("submit_image_task", request);
  expect((await call("submit_image_task", request)).taskId).toBe(queued.taskId);
  const status = () => call("get_image_task", { taskId: queued.taskId });
  await expect
    .poll(async () => (await status()).state, { timeout: 25000 })
    .toBe("succeeded");
  const complete = await status();
  expect(complete.outputs).toHaveLength(3);
  expect(complete.used).toBe(3);
  const pending = await (
    await page.request.get(`/api/projects/${id}/canvas/outputs`)
  ).json();
  expect(pending.outputs).toEqual([]);
  expect(await page.locator(".react-flow__node-image").count()).toBe(1);
  const operations = complete.outputs.flatMap(
    ({ assetId }: { assetId: string }, index: number) => {
      const x = 80 + index * 180;
      const label = `背景方案 ${index + 1}`;
      return [
        {
          action: "add_image",
          node: {
            id: randomUUID(),
            assetId,
            x,
            y: 250,
            width: 128,
            height: 128,
            label,
          },
        },
        {
          action: "add_text",
          node: {
            id: randomUUID(),
            x,
            y: 390,
            width: 128,
            height: 60,
            label: "标题",
            text: label,
          },
        },
      ];
    },
  );
  const edit = {
    revision: snapshot.revision,
    requestKey: randomUUID(),
    operations,
  };
  await page.getByRole("button", { name: "在 Codex 中继续" }).click();
  await dialog.getByRole("tab", { name: "项目活动记录" }).click();
  await expect(
    dialog.getByRole("row").filter({ hasText: "外部 Agent 提交生图" }),
  ).toContainText("查看任务");
  await expect(dialog.getByRole("button", { name: "撤销 v2" })).toHaveCount(0);
  expect((await call("edit_canvas", edit)).revision).toBe(2);
  expect((await call("edit_canvas", edit)).revision).toBe(2);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(4);
  await expect(page.locator(".react-flow__node-text")).toHaveCount(3);
  await expect(page.locator(".canvas-status")).toContainText("v2");
  await expect(
    dialog.getByRole("row").filter({ hasText: "外部 Agent 修改画布" }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("row").filter({ hasText: "外部 Agent 提交生图" }),
  ).toContainText("查看任务");
  const tasks = await (
    await page.request.get(`/api/images/tasks?projectId=${id}`)
  ).json();
  expect(tasks.tasks).toHaveLength(1);
  expect(tasks.tasks[0]).toMatchObject({
    id: queued.taskId,
    state: "succeeded",
    used: 3,
  });
  await dialog.getByRole("button", { name: "查看任务" }).click();
  await expect(dialog.getByText(queued.taskId, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "返回活动记录" }).click();
  await dialog.getByRole("button", { name: "撤销 v2" }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    dialog.getByRole("row").filter({ hasText: "撤销外部编辑" }),
  ).toContainText("v3");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-text")).toHaveCount(0);
  const completedAfterUndo = await status();
  expect(completedAfterUndo).toMatchObject({ state: "succeeded", used: 3 });
  expect(completedAfterUndo.outputs).toHaveLength(3);
});
