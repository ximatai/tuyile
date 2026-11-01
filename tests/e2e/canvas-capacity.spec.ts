import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { CANVAS_REQUEST_MAX_BYTES, emptyCanvas } from "@tuyile/contracts";

test("large legal text canvases save, edit and copy while request limits stay bounded", async ({
  page,
}) => {
  const auth = JSON.parse(await readFile(".codex-temp/e2e-auth.json", "utf8"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("账号", { exact: true }).fill(auth.username);
  await page.getByLabel("密码", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "我的项目", exact: true }).waitFor();
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
    "X-CSRF-Token": session.csrfToken,
  };
  const projectResponse = await page.request.post("/api/projects", {
    headers,
    data: { name: "大文案画布容量验收" },
  });
  expect(projectResponse.ok()).toBe(true);
  const project = await projectResponse.json();
  const url = `/api/projects/${project.id}/canvas`;
  const text = "中".repeat(4000);
  const input = {
    revision: 0,
    requestKey: randomUUID(),
    placements: [],
    document: {
      ...emptyCanvas(),
      nodes: Array.from({ length: 90 }, (_, i) => ({
        id: randomUUID(),
        kind: "text",
        label: `便签${i}`,
        text,
        tone: "yellow",
        x: 60 + (i % 3) * 330,
        y: 60 + Math.floor(i / 3) * 240,
        width: 300,
        height: 220,
      })),
    },
  };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(1024 * 1024);
  const saved = await page.request.post(url, { headers, data: input });
  expect(saved.ok()).toBe(true);
  await page.goto(`/projects/${project.id}`);
  const first = page.locator(".canvas-text-body").first();
  await first.dblclick();
  const editor = page.getByLabel("文案正文", { exact: true });
  const edited = "已编辑" + text.slice(3);
  await editor.fill(edited);
  await editor.press("ControlOrMeta+Enter");
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
  const persisted = await (await page.request.get(url)).json();
  expect(persisted.document.nodes[0].text).toBe(edited);
  expect(persisted.document.nodes).toHaveLength(90);
  const copy = await page.request.post(url + "/copy", {
    headers,
    data: { ...input, document: persisted.document, requestKey: randomUUID() },
  });
  expect(copy.ok()).toBe(true);
  const copiedProject = await copy.json();
  const copied = await (
    await page.request.get(`/api/projects/${copiedProject.id}/canvas`)
  ).json();
  expect(copied.document).toEqual(persisted.document);
  await page.reload();
  await expect(first).toHaveText(edited);
  // The larger allowance is exclusive to save/copy; drafts retain 1 MiB.
  const draftRejected = await page.request.post(
    `/api/projects/${project.id}/draft`,
    { headers, data: input },
  );
  expect(draftRejected.status()).toBe(413);
  const oversized = " ".repeat(CANVAS_REQUEST_MAX_BYTES + 1);
  for (const path of [url, url + "/copy"]) {
    // Test the API boundary directly: Vite may surface an early upstream rejection
    // as EPIPE while it is still forwarding a large body.
    const rejected = await page.request.post("http://127.0.0.1:8793" + path, {
      headers,
      data: oversized,
    });
    expect(rejected.status()).toBe(413);
    expect((await rejected.json()).error.code).toBe("BODY_TOO_LARGE");
  }
});
