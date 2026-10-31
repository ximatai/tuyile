import { finishTemporaryPassword } from "../test-database.js";
import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasService, LibraryService } from "@tuyile/core";
import { PgCanvasStore, PgLibraryStore } from "@tuyile/infrastructure";
import { emptyCanvas } from "@tuyile/contracts";
import { unzipSync } from "fflate";
import { imageFixture } from "../creation-fixture.js";
import { testPassword } from "../test-database.js";
import { createApp } from "../../apps/api/src/app.js";
let f: Awaited<ReturnType<typeof imageFixture>>,
  library: LibraryService,
  canvas: CanvasService;
beforeEach(async () => {
  f = await imageFixture();
  library = new LibraryService(new PgLibraryStore(f.pool));
  canvas = new CanvasService(new PgCanvasStore(f.pool));
});
afterEach(async () => {
  await f?.cleanup();
});
it("reuses workspace originals across projects without image charges and reports current references", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const project = await f.service.createProject(
    f.principal,
    "Reuse destination",
  );
  await canvas.save(f.principal, project.id, {
    revision: 0,
    requestKey: randomUUID(),
    placements: [],
    document: {
      ...emptyCanvas(),
      nodes: [
        {
          id: randomUUID(),
          kind: "image",
          assetId: asset.id,
          label: "复用",
          x: 40,
          y: 40,
          width: 200,
          height: 200,
        },
      ],
    },
  });
  expect((await library.assets(f.principal))[0].id).toBe(asset.id);
  expect((await f.repo.usage(f.principal)).used).toBe(0);
  expect(await library.references(f.principal, asset.id)).toContainEqual({
    kind: "canvas",
    id: project.id,
    label: project.name,
    projectId: project.id,
  });
  await expect(
    f.creation.deleteAsset(f.principal, asset.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
});
it("protects favorites and supports private prompt groups without calling a model", async () => {
  const asset = await f.creation.upload(f.principal, f.png),
    id = randomUUID();
  await library.saveFavorite(f.principal, {
    id,
    title: "参考素材",
    groupName: "产品",
    assetId: asset.id,
  });
  await expect(
    f.creation.deleteAsset(f.principal, asset.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  expect(await library.groups(f.principal)).toEqual(["产品"]);
  await library.saveFavorite(f.principal, {
    id,
    title: "商品原图",
    groupName: "待选",
    assetId: asset.id,
  });
  expect((await library.favorites(f.principal, 0, "待选"))[0].title).toBe(
    "商品原图",
  );
  expect(await library.references(f.principal, asset.id)).toContainEqual({
    kind: "favorite",
    id,
    label: "商品原图",
    projectId: null,
  });
  await library.removeFavorite(f.principal, id);
  await f.creation.delete(f.principal, asset.id);
  await library.saveFavorite(f.principal, {
    id: randomUUID(),
    title: "我的提示词",
    groupName: "常用",
    prompt: "商品测试提示词",
  });
  expect((await library.favorites(f.principal))[0].prompt).toBe(
    "商品测试提示词",
  );
  expect(await f.repo.tasks(f.principal)).toEqual([]);
});
it("serializes favorite creation against original deletion", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const results = await Promise.allSettled([
    library.saveFavorite(f.principal, {
      id: randomUUID(),
      title: "Race",
      groupName: "",
      assetId: asset.id,
    }),
    f.creation.deleteAsset(f.principal, asset.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failed = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  expect(["ASSET_REFERENCED", "REFERENCE_UNAVAILABLE"]).toContain(
    failed.reason.code,
  );
});
it("exports only authorized private originals and denies cross-workspace favorite changes", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const favoriteId = randomUUID();
  await library.saveFavorite(f.principal, {
    id: favoriteId,
    title: "Private",
    groupName: "",
    assetId: asset.id,
  });
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
    undefined,
    canvas,
    undefined,
    library,
  );
  const session = await f.service.authenticate(f.login.token);
  const headers = {
    cookie: `tuyile_session=${f.login.token}`,
    Origin: "http://127.0.0.1:5180",
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  };
  const response = await app.request("/api/library/export", {
    method: "POST",
    headers,
    body: JSON.stringify({ assetIds: [asset.id] }),
  });
  expect(response.status).toBe(200);
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  expect(Object.keys(zip)).toEqual([`${asset.id}.png`]);
  expect(Buffer.from(zip[`${asset.id}.png`])).toEqual(
    Buffer.from((await f.creation.bytes(f.principal, asset.id)).bytes),
  );
  const created = await f.service.createUser(f.principal, "library-member");
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login("library-member", testPassword),
    other = await f.service.authenticate(login.token);
  expect(await library.assets(other.user)).toEqual([]);
  await expect(
    library.saveFavorite(other.user, {
      id: favoriteId,
      title: "Overwrite",
      groupName: "",
      prompt: "private",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const denied = await app.request("/api/library/export", {
    method: "POST",
    headers: {
      ...headers,
      cookie: `tuyile_session=${login.token}`,
      "X-CSRF-Token": other.csrfToken,
    },
    body: JSON.stringify({ assetIds: [asset.id] }),
  });
  expect(denied.status).toBe(404);
});

it("deletes project content and references while preserving Gallery originals and quota audit", async () => {
  const task = await f.creation.submit(f.principal, f.input());
  await f.worker();
  const done = await f.done(task.id),
    asset = done.outputs[0];
  await canvas.save(f.principal, f.project.id, {
    revision: 0,
    requestKey: randomUUID(),
    placements: [asset.outputId],
    document: {
      ...emptyCanvas(),
      nodes: [
        {
          id: randomUUID(),
          kind: "image",
          assetId: asset.id,
          label: "Private canvas",
          x: 0,
          y: 0,
          width: 200,
          height: 200,
        },
      ],
    },
  });
  await canvas.removeProject(f.principal, f.project.id);
  await canvas.removeProject(f.principal, f.project.id);
  expect(await f.service.projects(f.principal)).toEqual([]);
  await expect(
    f.service.project(f.principal, f.project.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await library.assets(f.principal)).map((a) => a.id)).toContain(
    asset.id,
  );
  expect(await library.references(f.principal, asset.id)).toEqual([]);
  expect(await f.repo.usage(f.principal)).toMatchObject({ used: 1, held: 0 });
  expect((await f.repo.task(f.principal, task.id)).prompt).toBe("");
  await expect(f.repo.submit(f.principal, f.input())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("serializes project deletion with admission and protects cancelling or pending-review tasks", async () => {
  const results = await Promise.allSettled([
    canvas.removeProject(f.principal, f.project.id),
    f.creation.submit(f.principal, f.input()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failure = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  expect(["NOT_FOUND", "PROJECT_BUSY"]).toContain(failure.reason.code);
  const project = await f.service.createProject(
    f.principal,
    "Active protected",
  );
  const task = await f.creation.submit(
    f.principal,
    f.input({ projectId: project.id }),
  );
  const work = (await f.repo.claim([], 0))!;
  await f.repo.cancel(f.principal, work.id);
  await expect(
    canvas.removeProject(f.principal, project.id),
  ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
  await f.repo.finish(work, "CANCELLED", true);
  await canvas.removeProject(f.principal, project.id);
  expect(
    (await f.pool.query("SELECT state FROM image_tasks WHERE id=$1", [task.id]))
      .rows[0].state,
  ).toBe("cancelled");
  const pendingProject = await f.service.createProject(
    f.principal,
    "Unknown protected",
  );
  await f.creation.submit(
    f.principal,
    f.input({ projectId: pendingProject.id }),
  );
  const unknown = (await f.repo.claim([], 0))!,
    dispatch = (await f.repo.dispatch(unknown, 0, 0))!;
  await f.repo.attemptResult(dispatch.attemptId, "unknown");
  await f.repo.finish(unknown, "RESULT_UNKNOWN");
  expect((await f.repo.task(f.principal, unknown.id)).pendingReview).toBe(true);
  await expect(
    canvas.removeProject(f.principal, pendingProject.id),
  ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
});

it("publishes database templates globally while retaining private favorite snapshots and detecting concurrent edits", async () => {
  const seeded = await library.prompts(f.principal);
  expect(seeded).toHaveLength(36);
  const created = await f.service.createUser(f.principal, "template-member");
  await finishTemporaryPassword(f.service, created, testPassword);
  const memberLogin = await f.service.login("template-member", testPassword);
  const member = (await f.service.authenticate(memberLogin.token)).user;
  const input = {
    id: randomUUID(),
    title: "数据库新增",
    category: "测试",
    prompt: "初始完整正文",
    published: false,
    revision: 0,
  };
  const draft = await library.savePrompt(f.principal, input);
  expect(draft.revision).toBe(1);
  expect((await library.prompts(member)).some((p) => p.id === draft.id)).toBe(
    false,
  );
  await expect(library.managedPrompts(member)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(library.savePrompt(member, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const published = await library.savePrompt(f.principal, {
    ...input,
    revision: draft.revision,
    published: true,
  });
  expect(
    (await library.prompts(member)).find((p) => p.id === draft.id),
  ).toMatchObject({ prompt: input.prompt });
  const favoriteId = randomUUID();
  await library.saveFavorite(member, {
    id: favoriteId,
    title: input.title,
    groupName: input.category,
    prompt: input.prompt,
  });
  const races = await Promise.allSettled(
    ["first", "second"].map((prompt) =>
      library.savePrompt(f.principal, {
        ...input,
        prompt,
        revision: published.revision,
        published: true,
      }),
    ),
  );
  expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(races.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "PROMPT_TEMPLATE_CONFLICT" },
  });
  const current = (
    await library.managedPrompts(f.principal, 0, "数据库新增")
  )[0];
  await library.savePrompt(f.principal, {
    ...input,
    revision: current.revision,
    published: false,
  });
  expect((await library.prompts(member)).some((p) => p.id === draft.id)).toBe(
    false,
  );
  expect((await library.favorites(member))[0]).toMatchObject({
    id: favoriteId,
    prompt: input.prompt,
  });
  expect(await library.favorites(f.principal)).toHaveLength(0);
  const { migrate } = await import("../../scripts/migrate.js");
  await migrate(process.env.MIGRATION_DATABASE_URL!);
  expect(
    (await library.managedPrompts(f.principal, 0, "数据库新增"))[0].published,
  ).toBe(false);
  expect(await library.prompts(member)).toHaveLength(36);
});

it("guards prompt HTTP writes, validates content and returns only published bounded pages", async () => {
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
    undefined,
    canvas,
    undefined,
    library,
  );
  const session = await f.service.authenticate(f.login.token);
  const headers = {
    cookie: `tuyile_session=${f.login.token}`,
    Origin: "http://127.0.0.1:5180",
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  };
  expect((await app.request("/api/library/prompts")).status).toBe(401);
  const input = {
    id: randomUUID(),
    title: "新模板",
    category: "测试",
    prompt: "图".repeat(12000),
    published: true,
    revision: 0,
  };
  expect(
    (
      await app.request("/api/admin/prompts", {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "wrong" },
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/admin/prompts", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...input, prompt: " " }),
      })
    ).status,
  ).toBe(400);
  const created = await f.service.createUser(
    f.principal,
    "template-api-member",
  );
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login("template-api-member", testPassword),
    other = await f.service.authenticate(login.token);
  const otherHeaders = {
    ...headers,
    cookie: `tuyile_session=${login.token}`,
    "X-CSRF-Token": other.csrfToken,
  };
  expect(
    (await app.request("/api/admin/prompts", { headers: otherHeaders })).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/admin/prompts", {
        method: "POST",
        headers: otherHeaders,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/admin/prompts", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request("/api/admin/prompts", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(409);
  // Exercise pagination with synthetic public content through the real service.
  for (let i = 0; i < 49; i++)
    await library.savePrompt(f.principal, {
      ...input,
      id: randomUUID(),
      title: `分页${i}`,
      prompt: "分页正文",
    });
  const first = await (
    await app.request("/api/library/prompts", { headers: otherHeaders })
  ).json();
  const next = await (
    await app.request("/api/library/prompts?offset=50", {
      headers: otherHeaders,
    })
  ).json();
  expect(first.prompts).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  expect(next.prompts).toHaveLength(36);
  expect(next.hasMore).toBe(false);
  expect(
    new Set([...first.prompts, ...next.prompts].map((p) => p.id)).size,
  ).toBe(86);
  expect(first.prompts[0]).not.toHaveProperty("revision");
  expect(
    [...first.prompts, ...next.prompts].find((p) => p.id === input.id).prompt,
  ).toHaveLength(12000);
  expect(
    (
      await app.request("/api/admin/prompts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...input,
          id: randomUUID(),
          prompt: "图".repeat(12001),
        }),
      })
    ).status,
  ).toBe(400);
});

it("ships diverse valid starter prompts and never overwrites edited or unpublished entries when importing again", async () => {
  const rows = await library.managedPrompts(f.principal);
  expect(rows).toHaveLength(36);
  expect(new Set(rows.map((r) => r.category)).size).toBe(10);
  expect(new Set(rows.map((r) => r.id)).size).toBe(36);
  const { promptTemplateInput } = await import("@tuyile/contracts");
  for (const { id, title, category, prompt, published, revision } of rows) {
    expect(
      promptTemplateInput.safeParse({
        id,
        title,
        category,
        prompt,
        published,
        revision,
      }).success,
    ).toBe(true);
    expect(prompt.length).toBeGreaterThan(40);
  }
  const starter = rows.find((r) => r.id === "product-white-background")!;
  await library.savePrompt(f.principal, {
    id: starter.id,
    title: "管理员保留的标题",
    category: starter.category,
    prompt: "管理员编辑后的正文",
    published: false,
    revision: starter.revision,
  });
  const { createDatabase } = await import("@tuyile/infrastructure");
  const { readFile } = await import("node:fs/promises");
  const { pool } = createDatabase(process.env.MIGRATION_DATABASE_URL!);
  try {
    await pool.query(
      await readFile(
        new URL(
          "../../migrations/0018_starter_prompt_library.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  } finally {
    await pool.end();
  }
  const after = await library.managedPrompts(
    f.principal,
    0,
    "管理员保留的标题",
  );
  expect(after[0]).toMatchObject({
    id: starter.id,
    title: "管理员保留的标题",
    prompt: "管理员编辑后的正文",
    published: false,
    revision: starter.revision + 1,
  });
  expect(await library.managedPrompts(f.principal)).toHaveLength(36);
});

it("filters published prompts by the union of categories before pagination and exposes all published categories", async () => {
  // A category whose only entry is beyond page one must still be discoverable.
  for (let i = 0; i < 20; i++)
    await library.savePrompt(f.principal, {
      id: randomUUID(),
      title: `额外${i}`,
      category: "分页测试",
      prompt: "分页测试正文",
      published: true,
      revision: 0,
    });
  const late = await library.savePrompt(f.principal, {
    id: randomUUID(),
    title: "最后的分类",
    category: "末页分类",
    prompt: "只能在后续页找到的完整内容",
    published: true,
    revision: 0,
  });
  await library.savePrompt(f.principal, {
    id: randomUUID(),
    title: "未公开",
    category: "隐藏分类",
    prompt: "隐藏正文",
    published: false,
    revision: 0,
  });
  const first = await library.promptPage(f.principal);
  expect(first.prompts).toHaveLength(50);
  expect(first.prompts.some((p) => p.id === late.id)).toBe(false);
  expect(first.categories).toContain("末页分类");
  expect(first.categories).not.toContain("隐藏分类");
  const filtered = await library.promptPage(f.principal, 0, [
    "末页分类",
    "商品",
  ]);
  expect(new Set(filtered.prompts.map((p) => p.category))).toEqual(
    new Set(["末页分类", "商品"]),
  );
  expect(filtered.prompts).toHaveLength(5);
  expect(filtered.categories).toEqual(first.categories);
  expect(filtered.hasMore).toBe(false);
  expect(
    (await library.promptPage(f.principal, 0, ["不存在"])).prompts,
  ).toEqual([]);
  expect((await library.promptPage(f.principal, 0, [])).prompts).toHaveLength(
    50,
  );
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
    undefined,
    canvas,
    undefined,
    library,
  );
  const response = await app.request(
    "/api/library/prompts?category=" +
      encodeURIComponent("商品") +
      "&category=" +
      encodeURIComponent("末页分类"),
    { headers: { cookie: `tuyile_session=${f.login.token}` } },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).prompts).toHaveLength(5);
  expect(
    (
      await app.request("/api/library/prompts?category=", {
        headers: { cookie: `tuyile_session=${f.login.token}` },
      })
    ).status,
  ).toBe(400);
});
