import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
import { imageCapabilityDefaults } from "@tuyile/contracts";

test("SVG generation exports the original, previews safely, and converts references explicitly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrfToken,
  };
  const model = "gpt-image-2.6-flare";
  expect(
    (
      await page.request.post("/api/model-admin/bootstrap", {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const service = await (
    await page.request.post("/api/model-admin/services", {
      headers,
      data: {
        name: "Synthetic Image26",
        mode: "fake",
        baseUrl: "",
        preserveKey: false,
      },
    })
  ).json();
  expect(
    (
      await page.request.post(
        `/api/model-admin/services/${service.id}/manual`,
        { headers, data: { modelId: model } },
      )
    ).ok(),
  ).toBe(true);
  const catalog = await (
    await page.request.get("/api/model-admin/catalog")
  ).json();
  try {
    const response = await page.request.post("/api/model-admin/pools", {
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
              complexities: ["low", "medium", "high"],
              formats: ["png", "svg"],
              svgAuthor: { mode: "service-default" },
            },
          },
        ],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const project = await (
      await page.request.post("/api/projects", {
        headers,
        data: { name: `Image26-${randomUUID().slice(0, 8)}` },
      })
    ).json();
    const violations: string[] = [];
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /Content Security Policy|style-src|script-src/i.test(m.text())
      )
        violations.push(m.text());
    });
    await page.goto(`/projects/${project.id}`);
    await page.getByLabel("创作需求", { exact: true }).fill("合成矢量图标");
    await page.getByLabel("格式", { exact: true }).click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
      .getByText("SVG", { exact: true })
      .click();
    await expect(page.getByText(/矢量创作：无参考图、单张输出/)).toBeVisible();
    await page
      .getByRole("button", { name: "提交图片任务", exact: true })
      .click();
    let task: any;
    await expect
      .poll(async () => {
        task = (
          await (
            await page.request.get(`/api/images/tasks?projectId=${project.id}`)
          ).json()
        ).tasks[0];
        return task?.state;
      })
      .toBe("succeeded");
    const assetId = task.outputs[0].id;
    const preview = await page.request.get(
      `/api/images/assets/${assetId}/original`,
    );
    expect(preview.headers()["content-type"]).toContain("image/webp");
    const original = await page.request.get(
      `/api/images/assets/${assetId}/download`,
    );
    expect(original.headers()["content-disposition"]).toContain(".svg");
    expect(await original.text()).toContain("<circle");
    await page.goto("/gallery");
    const card = page.locator("article").filter({
      has: page.locator(`a[href='/api/images/assets/${assetId}/download']`),
    });
    await expect(card.locator("img").first()).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card.getByText("下载原图", { exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${assetId}.svg`);
    await card
      .getByRole("button", { name: "图片更多操作", exact: true })
      .click();
    await page.getByText("收藏图片", { exact: true }).click();
    await page.getByRole("button", { name: "保存收藏", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "编辑收藏" })).toBeHidden();
    await card.getByRole("button", { name: "加入画布", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`));
    await expect(
      page
        .locator(
          `.react-flow__node img[src='/api/images/assets/${assetId}/preview']`,
        )
        .first(),
    ).toBeVisible();
    await page.goto("/favorites");
    await expect(
      page.locator(`img[src='/api/images/assets/${assetId}/preview']`).first(),
    ).toBeVisible();
    await page.goto("/gallery");
    await card.getByRole("button", { name: "用作参考", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "请确认" });
    await expect(dialog).toContainText("PNG 栅格副本");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page).toHaveURL(/gallery/);
    await card.getByRole("button", { name: "用作参考", exact: true }).click();
    await page
      .getByRole("dialog", { name: "请确认" })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`));
    await expect
      .poll(async () => {
        const draft = await (
          await page.request.get(`/api/projects/${project.id}/draft`)
        ).json();
        return (
          !!draft.document.referenceIds[0] &&
          draft.document.referenceIds[0] !== assetId
        );
      })
      .toBe(true);
    const draft = await (
      await page.request.get(`/api/projects/${project.id}/draft`)
    ).json();
    const copy = await (
      await page.request.get(
        `/api/images/assets/${draft.document.referenceIds[0]}`,
      )
    ).json();
    expect(copy.mime).toBe("image/png");
    expect(copy.derivedFrom).toBe(assetId);
    const usage = await (await page.request.get("/api/images/usage")).json();
    expect(usage.used).toBeGreaterThanOrEqual(1);
    await page.getByLabel("格式", { exact: true }).click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
      .getByText("PNG", { exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "提交图片任务", exact: true }),
    ).toBeEnabled();
    let release!: () => void, arrive!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await page.route(`**/api/images/assets/${assetId}`, async (route) => {
      arrive();
      await gate;
      await route.continue();
    });
    await page
      .locator(
        `.react-flow__node img[src='/api/images/assets/${assetId}/preview']`,
      )
      .last()
      .locator("..")
      .hover();
    await page
      .getByRole("button", { name: "作为参考图", exact: true })
      .last()
      .click();
    await arrived;
    await expect(
      page.getByRole("button", { name: "提交图片任务", exact: true }),
    ).toBeDisabled();
    release();
    await page
      .getByRole("dialog", { name: "请确认" })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "提交图片任务", exact: true }),
    ).toBeEnabled();
    const after = await (
      await page.request.get(`/api/projects/${project.id}/draft`)
    ).json();
    expect(after.document.referenceIds).toEqual([copy.id]);
    expect(violations).toEqual([]);
  } finally {
    const latest = await (
      await page.request.get("/api/model-admin/catalog")
    ).json();
    expect(
      (
        await page.request.post("/api/model-admin/pools", {
          headers,
          data: { revision: latest.revision, entries: catalog.entries },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post(
          `/api/model-admin/services/${service.id}/state`,
          {
            headers,
            data: { revision: service.revision, enabled: false, revoke: false },
          },
        )
      ).ok(),
    ).toBe(true);
  }
});
