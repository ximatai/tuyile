import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { imageCapabilityDefaults, emptyCanvas } from "@tuyile/contracts";
import { loginAdmin } from "./admin-session";

test("mark an original, restore editing draft and recover a lost submission into a comparison", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|style-src|script-src/i.test(message.text())
    )
      violations.push(message.text().slice(0, 140));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrfToken,
  };
  await page.request.post("/api/model-admin/bootstrap", { headers, data: {} });
  const service = await (
    await page.request.post("/api/model-admin/services", {
      headers,
      data: { name: "Synthetic edit", mode: "fake", baseUrl: "" },
    })
  ).json();
  const model = "gpt-image-2.6-flare";
  await page.request.post(`/api/model-admin/services/${service.id}/manual`, {
    headers,
    data: { modelId: model },
  });
  const catalog = await (
    await page.request.get("/api/model-admin/catalog")
  ).json();
  try {
    expect(
      (
        await page.request.post("/api/model-admin/pools", {
          headers,
          data: {
            revision: catalog.revision,
            entries: [
              ...catalog.entries.map((e: any) =>
                e.kind === "image" ? { ...e, isDefault: false } : e,
              ),
              {
                id: randomUUID(),
                serviceId: service.id,
                modelId: model,
                kind: "image",
                enabled: true,
                isDefault: true,
                image: {
                  ...imageCapabilityDefaults(model),
                  maxEdge: 3840,
                  maxPixels: 8294400,
                  markup: true,
                },
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    const project = await (
      await page.request.post("/api/projects", {
        headers,
        data: { name: `Edit-${randomUUID().slice(0, 6)}` },
      })
    ).json();
    const png = await sharp({
      create: { width: 256, height: 256, channels: 3, background: "#987654" },
    })
      .png()
      .toBuffer();
    const source = await (
      await page.request.post("/api/images/uploads", {
        headers: { ...headers, "Content-Type": "image/png" },
        data: png,
      })
    ).json();
    const canvas = emptyCanvas();
    canvas.nodes.push({
      id: randomUUID(),
      kind: "image",
      assetId: source.id,
      x: 80,
      y: 80,
      width: 260,
      height: 260,
      label: "Synthetic original",
    });
    expect(
      (
        await page.request.post(`/api/projects/${project.id}/canvas`, {
          headers,
          data: {
            revision: 0,
            requestKey: randomUUID(),
            document: canvas,
            placements: [],
          },
        })
      ).ok(),
    ).toBe(true);
    const navigation = await page.goto(`/projects/${project.id}`);
    if (new URL(page.url()).port === "8794")
      expect(navigation?.headers()["content-security-policy"]).toMatch(
        /style-src[^;]*nonce-/,
      );
    await page.locator(".react-flow__node-image").hover();
    await page.getByRole("button", { name: "修改图片", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "修改图片", exact: true });
    await dialog
      .getByLabel("修改需求", { exact: true })
      .fill("把圈出的区域改为蓝色");
    await dialog.getByLabel("保持要求", { exact: true }).fill("保持主体位置");
    const overlay = dialog.getByLabel("图片标注区域", { exact: true });
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      box!.x + box!.width * 0.2,
      box!.y + box!.height * 0.2,
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width * 0.7,
      box!.y + box!.height * 0.7,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/projects/${project.id}/draft`)
            ).json()
          ).document.edit?.annotation.strokes.length,
      )
      .toBe(1);
    await dialog
      .getByRole("button", { name: "保存并关闭", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("button", { name: "继续图片修改", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "修改图片", exact: true });
    await expect(dialog.getByLabel("修改需求", { exact: true })).toHaveValue(
      "把圈出的区域改为蓝色",
    );
    await expect(dialog.locator("ellipse")).toHaveCount(1);
    const remote = await (
      await page.request.get(`/api/projects/${project.id}/draft`)
    ).json();
    expect(
      (
        await page.request.post(`/api/projects/${project.id}/draft`, {
          headers,
          data: {
            revision: remote.revision,
            requestKey: randomUUID(),
            document: {
              ...remote.document,
              edit: { ...remote.document.edit, prompt: "Remote edit" },
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await dialog
      .getByLabel("修改需求", { exact: true })
      .fill("保留本地修改并调整圈内颜色");
    await dialog
      .getByRole("button", { name: "保留当前版本", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "请确认" })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/projects/${project.id}/draft`)
            ).json()
          ).document.edit.prompt,
      )
      .toBe("保留本地修改并调整圈内颜色");
    let drop = true;
    await page.route("**/api/images/tasks", async (route) => {
      if (route.request().method() === "POST" && drop) {
        drop = false;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog
      .getByRole("button", { name: "生成修改结果", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "找回／重试原提交", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "找回／重试原提交", exact: true })
      .click();
    await expect(
      dialog.getByAltText("修改结果", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByAltText("比较原图", { exact: true }),
    ).toBeVisible();
    const { tasks } = await (
      await page.request.get(`/api/images/tasks?projectId=${project.id}`)
    ).json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].settings.annotation.strokes).toHaveLength(1);
    expect(tasks[0].settings.referenceIds).toEqual([source.id]);
    const output = tasks[0].outputs[0];
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("link", { name: "下载修改稿", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${output.id}.png`);
    await dialog
      .getByRole("button", { name: "基于原图再试", exact: true })
      .click();
    await expect(dialog.getByAltText("待修改原图")).toHaveAttribute(
      "src",
      `/api/images/assets/${source.id}/original`,
    );
    await expect(dialog.locator("ellipse")).toHaveCount(1);
    await dialog.getByText("前后比较", { exact: true }).click();
    await dialog
      .getByRole("button", { name: "用修改稿继续修改", exact: true })
      .click();
    await expect(dialog.getByAltText("待修改原图")).toHaveAttribute(
      "src",
      `/api/images/assets/${output.id}/original`,
    );
    await expect(
      dialog.getByRole("textbox", { name: "修改需求", exact: true }),
    ).toHaveValue("");
    await expect(dialog.getByLabel("保持要求", { exact: true })).toHaveValue(
      "保持主体位置",
    );
    await expect(dialog.locator("ellipse")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "保存并关闭", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("button", { name: "继续图片修改", exact: true })
      .click();
    await expect(dialog.getByAltText("待修改原图")).toHaveAttribute(
      "src",
      `/api/images/assets/${output.id}/original`,
    );
    const finalTasks = await (
      await page.request.get(`/api/images/tasks?projectId=${project.id}`)
    ).json();
    expect(finalTasks.tasks).toHaveLength(1);
  } finally {
    const latest = await (
      await page.request.get("/api/model-admin/catalog")
    ).json();
    await page.request.post("/api/model-admin/pools", {
      headers,
      data: { revision: latest.revision, entries: catalog.entries },
    });
    await page.request.post(`/api/model-admin/services/${service.id}/state`, {
      headers,
      data: { revision: service.revision, enabled: false, revoke: false },
    });
  }
});
