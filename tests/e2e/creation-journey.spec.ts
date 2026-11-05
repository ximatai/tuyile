import packageMetadata from "../../package.json" with { type: "json" };
const { version } = packageMetadata;
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { imageCapabilityDefaults } from "@tuyile/contracts";
import { loginAdmin } from "./admin-session";

test("an exploration becomes a marked revision, an Agent derivative, a vector export and a reusable project work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdmin(page);
  expect((await (await page.request.get("/api/health")).json()).version).toBe(
    version,
  );
  const session = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrfToken,
  };
  const post = async (path: string, data: any) => {
    const response = await page.request.post(`/api${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post("/model-admin/bootstrap", {});
  const service = await post("/model-admin/services", {
    name: `Journey-${randomUUID().slice(0, 6)}`,
    mode: "fake",
    baseUrl: "",
  });
  const model = "gpt-image-2.6-flare",
    imageId = randomUUID(),
    plannerId = randomUUID();
  await post(`/model-admin/services/${service.id}/manual`, { modelId: model });
  await post(`/model-admin/services/${service.id}/manual`, {
    modelId: "synthetic-journey-planner",
  });
  const catalog = await (
    await page.request.get("/api/model-admin/catalog")
  ).json();
  try {
    await post("/model-admin/pools", {
      revision: catalog.revision,
      entries: [
        ...catalog.entries.map((e: any) => ({ ...e, isDefault: false })),
        {
          id: imageId,
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
            complexities: ["low", "medium", "high"],
            formats: ["png", "svg"],
            svgAuthor: { mode: "service-default" },
          },
        },
        {
          id: plannerId,
          serviceId: service.id,
          modelId: "synthetic-journey-planner",
          kind: "conversation",
          enabled: true,
          isDefault: true,
          conversation: {
            supportsImages: true,
            responseMode: "json_object",
            maxOutputTokens: 4096,
            maxInputCharacters: 32000,
          },
        },
      ],
    });
    const project = await post("/projects", {
      name: `Journey-${randomUUID().slice(0, 6)}`,
    });
    const before = await (await page.request.get("/api/images/usage")).json();
    await page.goto(`/projects/${project.id}`);
    await page.getByLabel("创作需求", { exact: true }).fill("合成商品的主视觉");
    await page.getByRole("button", { name: "快速探索", exact: true }).click();
    await page
      .getByRole("dialog", { name: "请确认" })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page
      .getByRole("button", { name: "提交图片任务", exact: true })
      .click();
    const tasks = async () =>
      (
        await (
          await page.request.get(`/api/images/tasks?projectId=${project.id}`)
        ).json()
      ).tasks;
    await expect
      .poll(
        async () =>
          (await tasks()).filter((t: any) => t.state === "succeeded").length,
      )
      .toBe(1);
    const explored = (await tasks())[0];
    expect(explored.settings.complexity).toBe("low");
    await page.locator(".react-flow__node-image").hover();
    await page.getByRole("button", { name: "修改图片", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "修改图片", exact: true });
    await edit.getByLabel("修改需求", { exact: true }).fill("只修改圈内配色");
    await edit
      .getByLabel("保持要求", { exact: true })
      .fill("保留商品轮廓与品牌文字");
    const box = await edit
      .getByLabel("图片标注区域", { exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      box!.x + box!.width * 0.2,
      box!.y + box!.height * 0.2,
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width * 0.6,
      box!.y + box!.height * 0.6,
      { steps: 5 },
    );
    await page.mouse.up();
    await edit
      .getByRole("button", { name: "生成修改结果", exact: true })
      .click();
    await expect(edit.getByAltText("修改结果", { exact: true })).toBeVisible();
    await expect(edit.getByAltText("比较原图", { exact: true })).toBeVisible();
    await edit.getByRole("button", { name: "保存并关闭", exact: true }).click();
    const modified = (await tasks()).find((t: any) => t.id !== explored.id);
    expect(modified.settings.referenceIds).toEqual([explored.outputs[0].id]);
    expect(modified.settings.preserveRequirements).toBe(
      "保留商品轮廓与品牌文字",
    );
    const spec = {
      model,
      modelSelectionId: imageId,
      width: 1024,
      height: 1024,
      quality: "high",
      complexity: "high",
      format: "png",
      referenceIds: [modified.outputs[0].id],
    };
    const job = await post("/agent/planning", {
      ...spec,
      projectId: project.id,
      requestKey: randomUUID(),
      conversationModelId: plannerId,
      prompt: "基于选定作品衍生横版陈列",
      preserveRequirements: modified.settings.preserveRequirements,
    });
    await expect
      .poll(async () => {
        const { jobs } = await (
          await page.request.get(`/api/agent/jobs?projectId=${project.id}`)
        ).json();
        return jobs.find((j: any) => j.id === job.id)?.state;
      })
      .toBe("succeeded");
    await page.getByRole("button", { name: "Agent 面板", exact: true }).click();
    await expect(
      page.getByText("本方案保持要求", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认执行", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await tasks()).filter((t: any) => t.state === "succeeded").length,
      )
      .toBe(3);
    const derived = (await tasks()).find(
      (t: any) => ![explored.id, modified.id].includes(t.id),
    );
    expect(derived.finalPrompt).toContain("保留商品轮廓与品牌文字");
    expect(derived.settings.referenceIds).toEqual([modified.outputs[0].id]);
    await expect
      .poll(async () => {
        const sources = await (
          await page.request.get(`/api/projects/${project.id}/canvas/sources`)
        ).json();
        return sources.some(
          (s: any) =>
            s.assetId === derived.outputs[0].id &&
            s.sourceIds.includes(modified.outputs[0].id),
        );
      })
      .toBe(true);
    const vector = await post("/images/tasks", {
      ...spec,
      format: "svg",
      referenceIds: [],
      count: 1,
      projectId: project.id,
      requestKey: randomUUID(),
      prompt: "合成蓝底白圆矢量图标",
    });
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/images/tasks/${vector.id}`)
            ).json()
          ).state,
      )
      .toBe("succeeded");
    const svg = (
      await (await page.request.get(`/api/images/tasks/${vector.id}`)).json()
    ).outputs[0].id;
    const download = await page.request.get(
      `/api/images/assets/${svg}/download`,
    );
    expect(download.headers()["content-type"]).toContain("image/svg+xml");
    const exported = await download.body();
    expect(exported.toString()).toContain("<circle");
    await mkdir(".codex-temp/acceptance", { recursive: true });
    await writeFile(".codex-temp/acceptance/journey.svg", exported, {
      mode: 0o600,
    });
    const other = await post("/projects", {
      name: `Reuse-${randomUUID().slice(0, 6)}`,
    });
    await page.goto("/gallery");
    const card = page.locator("article").filter({
      has: page.locator(`a[href='/api/images/assets/${svg}/download']`),
    });
    await card.getByRole("button", { name: "加入画布", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${other.id}`));
    await expect(
      page.locator(`img[src='/api/images/assets/${svg}/preview']`).first(),
    ).toBeVisible();
    const after = await (await page.request.get("/api/images/usage")).json();
    expect(after.used - before.used).toBe(4);
    expect(await tasks()).toHaveLength(4);
  } finally {
    const latest = await (
      await page.request.get("/api/model-admin/catalog")
    ).json();
    await post("/model-admin/pools", {
      revision: latest.revision,
      entries: catalog.entries,
    });
    await post(`/model-admin/services/${service.id}/state`, {
      revision: service.revision,
      enabled: false,
      revoke: false,
    });
  }
});
