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
  await expect(dialog.getByLabel("Codex MCP 配置")).toHaveValue(
    new RegExp(`${baseURL}/mcp`),
  );
  await expect(dialog.getByLabel("Codex MCP 配置")).toHaveValue(
    new RegExp(`tuyile_${id.replaceAll("-", "")}`),
  );
  await dialog.getByRole("button", { name: "签发令牌" }).click();
  const token = await dialog.getByLabel("项目访问令牌").inputValue();
  expect(token).toMatch(/^tuyile_/);
  await dialog.getByRole("button", { name: "复制给 Codex" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain(`${baseURL}/projects/${id}`);
  expect(prompt).not.toContain(token);
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
  expect(
    (await (await call(token, "read_canvas")).json()).result.structuredContent,
  ).toMatchObject({
    projectId: id,
    revision: 0,
  });
  await dialog.getByRole("button", { name: "撤销令牌" }).click();
  await expect(
    dialog.getByText("当前项目尚未授权。", { exact: false }),
  ).toBeVisible();
  expect((await call(token, "read_canvas")).status()).toBe(401);
  await dialog.getByRole("checkbox", { name: "允许编辑画布" }).check();
  await dialog.getByRole("button", { name: "签发令牌" }).click();
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
  await expect(page.getByRole("button", { name: "另存副本" })).toBeVisible();
  const serverCanvas = await (
    await page.request.get(`/api/projects/${id}/canvas`)
  ).json();
  expect(serverCanvas).toMatchObject({
    revision: 2,
    document: { nodes: [{ label: "远程标题", x: 130 }] },
  });
});
