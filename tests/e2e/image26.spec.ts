import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAdmin } from "./admin-session";
import { imageCapabilityDefaults } from "@tuyile/contracts";

test("2.6 complexity survives draft reload and generation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: "http://127.0.0.1:5180",
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
    await page.goto(`/projects/${project.id}`);
    await page.getByLabel("创作需求", { exact: true }).fill("合成的商品展示图");
    await page.getByText("进阶设置", { exact: true }).click();
    await page.getByLabel("复杂度", { exact: true }).click();
    await page.getByLabel("复杂度", { exact: true }).press("ArrowDown");
    await page.getByLabel("复杂度", { exact: true }).press("Enter");
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/projects/${project.id}/draft`)
            ).json()
          ).document.direct.settings.complexity,
      )
      .toBe("low");
    await page.reload();
    await page.getByText("进阶设置", { exact: true }).click();
    await expect(
      page
        .locator(".ant-select")
        .filter({ has: page.getByLabel("复杂度", { exact: true }) }),
    ).toContainText("低");
    await page
      .getByRole("button", { name: "提交图片任务", exact: true })
      .click();
    await expect
      .poll(async () => {
        const result = await (
          await page.request.get(`/api/images/tasks?projectId=${project.id}`)
        ).json();
        const task = (result.tasks ?? result)[0];
        return task?.state === "succeeded" ? task.settings.complexity : null;
      })
      .toBe("low");
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
