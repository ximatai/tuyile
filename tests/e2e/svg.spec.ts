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
        name: `Synthetic SVG-${randomUUID().slice(0, 8)}`,
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
    const shortcuts = page.getByRole("group", { name: "创作快捷操作" });
    const vector = shortcuts.getByRole("button", {
      name: "矢量创作（SVG）",
      exact: true,
    });
    await expect(vector).toBeVisible();
    expect(
      await shortcuts.getByRole("button").evaluateAll((buttons) => {
        const [first] = buttons;
        return {
          count: buttons.length,
          aligned: buttons.every(
            (button) =>
              button.getBoundingClientRect().top ===
              first?.getBoundingClientRect().top,
          ),
          fits: buttons.every(
            (button) => button.scrollWidth <= button.clientWidth,
          ),
        };
      }),
    ).toEqual({ count: 3, aligned: true, fits: true });
    await vector.click();
    await expect(vector).toHaveAttribute("aria-pressed", "true");
    await expect(vector).toBeEnabled();
    await expect(vector).toHaveCSS("background-color", "rgb(234, 244, 255)");
    await vector.click();
    await expect(vector).toHaveAttribute("aria-pressed", "true");
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
    const sourceNode = page
      .locator(".react-flow__node-image")
      .filter({
        has: page.locator(`img[src='/api/images/assets/${assetId}/preview']`),
      })
      .first();
    const openRevisions = async () => {
      await sourceNode.hover();
      const nodeId = await sourceNode.getAttribute("data-id");
      expect(nodeId).toBeTruthy();
      await page
        .locator(`.react-flow__node-toolbar[data-id="${nodeId}"]`)
        .getByRole("button", { name: "SVG 修订与交付", exact: true })
        .click();
      return page.getByRole("dialog", { name: "SVG 修订与交付", exact: true });
    };
    const revisionDialog = await openRevisions();
    const originalCard = revisionDialog.getByRole("region", { name: "原稿" });
    const revisionCard = revisionDialog.getByRole("region", { name: "修订稿" });
    await expect(
      originalCard.getByRole("link", { name: "下载原稿 SVG" }),
    ).toBeVisible();
    const exportOriginal = originalCard.getByRole("button", {
      name: "导出原稿 PNG",
    });
    await expect(exportOriginal).toBeEnabled();
    const importRevision = revisionCard.getByRole("button", {
      name: "导入修订稿",
    });
    await expect(importRevision).toBeVisible();
    await exportOriginal.click();
    const exportConfirm = page.getByRole("dialog", { name: "请确认" });
    await expect(exportConfirm).toContainText("将「原稿」导出为 PNG");
    await exportConfirm
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(exportConfirm).toBeHidden();
    const revisionFile = Buffer.from(
      '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g style="mix-blend-mode: normal"><rect width="1024" height="1024" fill="#0062b0"/><circle cx="576" cy="512" r="256" fill="#e8b844"/></g></svg>',
    );
    const imported = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/images/assets/${assetId}/svg-revisions`) &&
        r.request().method() === "POST",
    );
    await importRevision.focus();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      importRevision.press("Enter"),
    ]);
    await fileChooser.setFiles({
      name: "refined-icon.svg",
      mimeType: "image/svg+xml",
      buffer: revisionFile,
    });
    const importResponse = await imported;
    expect(importResponse.status()).toBe(201);
    const revision = await importResponse.json();
    await expect(revisionDialog.getByAltText("SVG 原稿预览")).toBeVisible();
    await expect(revisionDialog.getByAltText("SVG 修订稿预览")).toBeVisible();
    await expect(
      revisionCard.getByRole("combobox", { name: "比较修订稿" }),
    ).toBeFocused();
    await expect(revisionCard).toContainText("修订稿 1");
    await expect(
      revisionCard.getByRole("button", { name: "导入新稿" }),
    ).toBeVisible();
    await revisionCard
      .getByRole("button", { name: "将这稿加入画布", exact: true })
      .click();
    await expect(revisionDialog.getByRole("status")).toHaveText(
      "已将这稿加入画布",
    );
    const [revisedDownload] = await Promise.all([
      page.waitForEvent("download"),
      revisionCard
        .getByRole("link", { name: "下载这稿 SVG", exact: true })
        .click(),
    ]);
    expect(revisedDownload.suggestedFilename()).toBe(`${revision.id}.svg`);
    await revisionCard
      .getByRole("button", { name: "导出这稿 PNG", exact: true })
      .click();
    await expect(exportConfirm).toContainText(/将「修订稿 1 · .*」导出为 PNG/);
    const [pngDownload, rasterCopy] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/images/assets/${revision.id}/raster-copy`) &&
          response.request().method() === "POST",
      ),
      exportConfirm.getByRole("button", { name: "确认", exact: true }).click(),
    ]);
    expect(rasterCopy.ok()).toBe(true);
    expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);
    await revisionDialog
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    await page.reload();
    await expect(
      page.locator(
        `.react-flow__node img[src='/api/images/assets/${revision.id}/preview']`,
      ),
    ).toBeVisible();
    const reopened = await openRevisions();
    await expect(reopened.getByAltText("SVG 修订稿预览")).toHaveAttribute(
      "src",
      `/api/images/assets/${revision.id}/preview`,
    );
    await reopened
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
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
    await expect(vector).toHaveAttribute("aria-pressed", "false");
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
