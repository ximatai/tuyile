import { test, expect } from "@playwright/test";
import { loginAdmin } from "./admin-session";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { CANVAS_REQUEST_MAX_BYTES, emptyCanvas } from "@tuyile/contracts";

test("large legal text canvases save, edit and copy while request limits stay bounded", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginAdmin(page);
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
  // Exercise the real API's early Content-Length rejection without racing a
  // large body upload against the server closing the socket (EPIPE/ECONNRESET).
  async function rejectedSize(path: string, bytes: number) {
    return new Promise<{
      status: number | undefined;
      body: { error: { code: string } };
    }>((resolve, reject) => {
      const req = request(
        "http://127.0.0.1:8793" + path,
        {
          method: "POST",
          agent: false,
          headers: {
            "Content-Length": bytes,
            "Content-Type": "application/json",
            Expect: "100-continue",
            Connection: "close",
          },
        },
        async (response) => {
          try {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch (error) {
            reject(error);
          }
        },
      );
      req.on("error", reject);
      req.setTimeout(10000, () =>
        req.destroy(new Error("API did not reject oversized headers")),
      );
      req.end();
    });
  }
  for (const [path, bytes] of [
    [`/api/projects/${project.id}/draft`, 1024 * 1024 + 1],
    [url, CANVAS_REQUEST_MAX_BYTES + 1],
    [url + "/copy", CANVAS_REQUEST_MAX_BYTES + 1],
  ] as const) {
    const rejected = await rejectedSize(path, bytes);
    expect(rejected.status).toBe(413);
    expect(rejected.body.error.code).toBe("BODY_TOO_LARGE");
  }
});
