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
  const read = () =>
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
          name: "read_canvas",
          arguments: { projectUrl: `${baseURL}/projects/${id}` },
        },
      },
    });
  expect((await (await read()).json()).result.structuredContent).toMatchObject({
    projectId: id,
    revision: 0,
  });
  await dialog.getByRole("button", { name: "撤销令牌" }).click();
  await expect(
    dialog.getByText("当前项目尚未授权。", { exact: false }),
  ).toBeVisible();
  expect((await read()).status()).toBe(401);
});
