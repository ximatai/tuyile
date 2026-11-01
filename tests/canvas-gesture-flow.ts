import { expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
async function zoomGesture(page: Page, target: Locator, pinch = true) {
  const renderer = page.locator(".react-flow__renderer");
  const zoom = () =>
    page
      .locator(".react-flow__viewport")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  await target.hover({ timeout: 5000 });
  const before = await zoom();
  const pageScale = await page.evaluate(() => ({
    dpr: devicePixelRatio,
    width: innerWidth,
    scale: visualViewport?.scale,
  }));
  if (pinch) await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, -30);
  } finally {
    if (pinch) await page.keyboard.up("Control");
  }
  await expect.poll(zoom).toBeGreaterThan(before);
  if (pinch) await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, 30);
  } finally {
    if (pinch) await page.keyboard.up("Control");
  }
  await expect.poll(zoom).toBeCloseTo(before, 3);
  await expect
    .poll(() => renderer.evaluate((el) => !("__zooming" in el)))
    .toBe(true);
  expect(
    await page.evaluate(() => ({
      dpr: devicePixelRatio,
      width: innerWidth,
      scale: visualViewport?.scale,
    })),
  ).toEqual(pageScale);
}
export async function verifyCanvasGestures(page: Page) {
  const base = new URL(page.url()).origin;
  if (!["http://127.0.0.1:5180", "http://127.0.0.1:8792"].includes(base))
    throw new Error("REFUSE_NON_SYNTHETIC_TARGET");
  const session = await (await page.request.get(base + "/api/auth/me")).json();
  const response = await page.request.post(base + "/api/projects", {
    headers: { Origin: base, "X-CSRF-Token": session.csrfToken },
    data: { name: "触控板手势验收-" + randomUUID().slice(0, 8) },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto(base + "/projects/" + project.id);
  const canvas = page.getByRole("region", { name: "项目画布", exact: true });
  const png = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
  })
    .png()
    .toBuffer();
  await canvas
    .locator("input[type=file]")
    .setInputFiles({ name: "gesture.png", mimeType: "image/png", buffer: png });
  await expect(canvas.locator(".react-flow__node-image")).toHaveCount(1);
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  const editor = canvas.getByLabel("文案正文", { exact: true });
  await editor.fill("短文案");
  await zoomGesture(page, editor);
  await editor.press("ControlOrMeta+Enter");
  const body = canvas.locator(".canvas-text-body");
  const fit = async () => {
    await canvas.locator(".react-flow__controls-fitview").click();
    await expect
      .poll(() =>
        canvas
          .locator(".react-flow__renderer")
          .evaluate((el) => !("__zooming" in el)),
      )
      .toBe(true);
  };
  await fit();
  await zoomGesture(page, body);
  await fit();
  await zoomGesture(page, body, false);
  await fit();
  await zoomGesture(
    page,
    canvas.locator(".canvas-node-title-display").filter({ hasText: "文案" }),
  );
  await fit();
  await body.dblclick();
  const text = "长文案滚动测试\n".repeat(80);
  await editor.fill(text);
  await editor.press("ControlOrMeta+Enter");
  const zoom = () =>
    canvas
      .locator(".react-flow__viewport")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  let before = await zoom();
  await body.hover();
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => body.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await zoom()).toBeCloseTo(before, 3);
  await zoomGesture(page, body);
  await fit();
  await body.dblclick();
  await editor.evaluate((el) => {
    el.scrollTop = 0;
  });
  before = await zoom();
  await editor.hover();
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => editor.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await zoom()).toBeCloseTo(before, 3);
  await zoomGesture(page, editor);
  await editor.press("ControlOrMeta+Enter");
  await fit();
  await zoomGesture(page, canvas.locator(".canvas-image"));
  await expect(body).toHaveText(text.trim());
  await expect(page.locator(".canvas-status")).toContainText("画布已保存");
}
