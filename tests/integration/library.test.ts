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

it("searches the complete private project list before pagination and excludes deleted or foreign projects", async () => {
  const target = await f.service.createProject(
    f.principal,
    "Unique old destination",
  );
  for (let i = 0; i < 51; i++)
    await f.service.createProject(f.principal, `New destination ${i}`);
  expect(
    (await f.service.projects(f.principal)).some((p) => p.id === target.id),
  ).toBe(false);
  expect(await f.service.projects(f.principal, 0, "unique old")).toEqual([
    target,
  ]);
  const created = await f.service.createUser(
    f.principal,
    "project-search-member",
  );
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login("project-search-member", testPassword),
    member = (await f.service.authenticate(login.token)).user;
  expect(await f.service.projects(member, 0, "Unique old")).toEqual([]);
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
  );
  const response = await app.request("/api/projects?search=unique%20old", {
    headers: { cookie: `tuyile_session=${f.login.token}` },
  });
  expect(response.status).toBe(200);
  expect((await response.json()).projects[0].id).toBe(target.id);
  await f.pool.query("UPDATE projects SET deleted_at=now() WHERE id=$1", [
    target.id,
  ]);
  expect(await f.service.projects(f.principal, 0, "unique old")).toEqual([]);
});

it("filters favorite groups as a private union before pagination, including ungrouped content", async () => {
  const oldId = randomUUID();
  await library.saveFavorite(f.principal, {
    id: oldId,
    title: "旧收藏",
    groupName: "早期分组",
    prompt: "旧收藏正文",
  });
  for (let i = 0; i < 51; i++)
    await library.saveFavorite(f.principal, {
      id: randomUUID(),
      title: `分页收藏${i}`,
      groupName: "其他",
      prompt: "分页正文",
    });
  await library.saveFavorite(f.principal, {
    id: randomUUID(),
    title: "未分组收藏",
    groupName: "",
    prompt: "未分组正文",
  });
  expect(
    (await library.favorites(f.principal)).some((f) => f.id === oldId),
  ).toBe(false);
  expect(
    await library.favorites(f.principal, 0, ["早期分组", ""]),
  ).toHaveLength(2);
  expect(await library.groups(f.principal)).toEqual(["", "其他", "早期分组"]);
  const created = await f.service.createUser(
    f.principal,
    "favorite-filter-member",
  );
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login("favorite-filter-member", testPassword),
    other = (await f.service.authenticate(login.token)).user;
  expect(await library.favorites(other, 0, ["早期分组", ""])).toEqual([]);
  expect(await library.groups(other)).toEqual([]);
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
    "/api/library/favorites?group=" +
      encodeURIComponent("早期分组") +
      "&group=",
    { headers: { cookie: `tuyile_session=${f.login.token}` } },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).favorites).toHaveLength(2);
});

it("persists public and private styles with authorization, revisions and immutable task snapshots", async () => {
  const initial = await library.styles(f.principal);
  expect(initial).toHaveLength(5);
  const member = await f.service.createUser(f.principal, "style-member");
  await finishTemporaryPassword(f.service, member);
  const login = await f.service.login("style-member", testPassword),
    p = (await f.service.authenticate(login.token)).user;
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
  expect((await app.request("/api/library/styles")).status).toBe(401);
  const memberSession = await f.service.authenticate(login.token);
  const memberHeaders = {
    cookie: `tuyile_session=${login.token}`,
    Origin: "http://127.0.0.1:5180",
    "Content-Type": "application/json",
    "X-CSRF-Token": memberSession.csrfToken,
  };
  expect(
    (await app.request("/api/admin/styles", { headers: memberHeaders })).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/admin/styles", {
        method: "POST",
        headers: memberHeaders,
        body: JSON.stringify({
          id: randomUUID(),
          name: "禁止",
          text: "禁止",
          revision: 0,
          published: true,
        }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/library/styles", {
        method: "POST",
        headers: memberHeaders,
        body: JSON.stringify({
          id: randomUUID(),
          name: "",
          text: "",
          revision: 0,
        }),
      })
    ).status,
  ).toBe(400);
  const draft = {
    id: randomUUID(),
    name: "未上架风格",
    text: "独立的公共风格描述",
    revision: 0,
    published: false,
  };
  await expect(library.saveStyle(p, draft, true)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const shared = await library.saveStyle(f.principal, draft, true);
  expect((await library.styles(p)).some((s) => s.id === shared.id)).toBe(false);
  const published = await library.saveStyle(
    f.principal,
    { ...draft, published: true, revision: shared.revision },
    true,
  );
  expect((await library.styles(p)).some((s) => s.id === published.id)).toBe(
    true,
  );
  const personal = await library.saveStyle(p, {
    ...draft,
    id: randomUUID(),
    name: "我的风格",
    published: true,
  });
  expect(personal.scope).toBe("personal");
  expect(personal.published).toBe(false);
  expect(
    (await library.styles(f.principal)).some((s) => s.id === personal.id),
  ).toBe(false);
  await expect(
    library.saveStyle(f.principal, { ...draft, id: personal.id }, true),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    library.removeStyle(f.principal, personal.id, personal.revision),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await library.saveStyle(p, {
    ...draft,
    id: personal.id,
    revision: personal.revision,
    text: "更新后的个人风格",
  });
  await expect(
    library.saveStyle(p, {
      ...draft,
      id: personal.id,
      revision: personal.revision,
    }),
  ).rejects.toMatchObject({ code: "STYLE_CONFLICT" });
  await expect(
    library.removeStyle(p, personal.id, personal.revision),
  ).rejects.toMatchObject({ code: "STYLE_CONFLICT" });
  const snapshot = { name: published.name, text: published.text };
  const task = await f.creation.submit(
    f.principal,
    f.input({ style: snapshot }),
  );
  await library.saveStyle(
    f.principal,
    {
      ...draft,
      revision: published.revision,
      published: false,
      text: "变更后的公共风格",
    },
    true,
  );
  expect((await f.repo.task(f.principal, task.id)).settings?.style).toEqual(
    snapshot,
  );
  expect((await library.styles(p)).some((s) => s.id === published.id)).toBe(
    false,
  );
  await library.removeStyle(p, personal.id, personal.revision + 1);
  expect((await library.styles(p)).some((s) => s.id === personal.id)).toBe(
    false,
  );
  await expect(library.styles(p, true)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("calibrates only untouched starter styles and keeps the migration repeatable", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../../migrations/0020_refine_default_styles.sql", import.meta.url),
    "utf8",
  );
  const original = await library.styles(f.principal);
  expect(original.map((s) => s.name)).toEqual([
    "真实摄影",
    "商品棚拍",
    "平面插画",
    "海报视觉",
    "简洁 3D",
  ]);
  expect(original.every((s) => s.revision === 2)).toBe(true);
  await f.pool.query(sql);
  expect(await library.styles(f.principal)).toEqual(original);
  // Simulate four different states when upgrading a deployment from migration 19.
  const ids = original.map((s) => s.id);
  await f.pool.query(
    "UPDATE creation_styles SET name='真实摄影',text='真实摄影，自然光线，细腻材质，准确的光影与丰富细节。',revision=1 WHERE id=$1",
    [ids[0]],
  );
  await f.pool.query(
    "UPDATE creation_styles SET name='管理员的商品风格',text='管理员保留的独立内容',revision=1 WHERE id=$1",
    [ids[1]],
  );
  await f.pool.query(
    "UPDATE creation_styles SET name='精致插画',text='专业编辑插画，清晰造型，丰富而协调的配色，精致完成度。',revision=1,published=false WHERE id=$1",
    [ids[2]],
  );
  await f.pool.query(
    "UPDATE creation_styles SET name='海报视觉',text='鲜明的海报构图，突出视觉焦点，预留排版空间，电影感配色。',revision=3 WHERE id=$1",
    [ids[3]],
  );
  const personal = await library.saveStyle(f.principal, {
    id: randomUUID(),
    name: "真实摄影",
    text: "真实摄影，自然光线，细腻材质，准确的光影与丰富细节。",
    revision: 0,
    published: false,
  });
  await f.pool.query(sql);
  const managed = await library.styles(f.principal, true);
  expect(managed.find((s) => s.id === ids[0])).toEqual(original[0]);
  expect(managed.find((s) => s.id === ids[1])?.text).toBe(
    "管理员保留的独立内容",
  );
  expect(managed.find((s) => s.id === ids[2])).toMatchObject({
    name: "精致插画",
    published: false,
    revision: 1,
  });
  expect(managed.find((s) => s.id === ids[3])?.revision).toBe(3);
  expect(
    (await library.styles(f.principal)).find((s) => s.id === personal.id),
  ).toEqual(personal);
});

it("picks only personal text favorites before pagination and exposes only published recommendations", async () => {
  const base = { source: "favorites" as const, offset: 0, search: "" };
  expect((await library.promptPicker(f.principal, base)).items).toEqual([]);
  const initial = await library.promptPicker(f.principal, {
    ...base,
    source: "recommended",
  });
  expect(initial.items).toHaveLength(36);
  expect(initial.groups).toHaveLength(10);
  expect(initial.items.slice(0, 3).map((p) => p.id)).toEqual([
    "brand-banner",
    "illustration-scene",
    "product-studio",
  ]);
  expect(
    (
      await library.promptPicker(f.principal, {
        ...base,
        source: "recommended",
        search: "电商白底主图",
      })
    ).items,
  ).toHaveLength(1);
  const asset = await f.creation.upload(f.principal, f.png);
  await f.pool.query(
    "INSERT INTO library_favorites(id,workspace_id,title,group_name,prompt) SELECT gen_random_uuid(),$1,'提示词'||n,CASE WHEN n%2=0 THEN 'A组' ELSE 'B组' END,'完整正文'||n FROM generate_series(1,55) n",
    [f.principal.workspaceId],
  );
  await f.pool.query(
    "INSERT INTO library_favorites(id,workspace_id,title,group_name,asset_id,created_at) SELECT gen_random_uuid(),$1,'图片'||n,'仅图片分组',$2,now()+interval '1 day' FROM generate_series(1,55) n",
    [f.principal.workspaceId, asset.id],
  );
  const first = await library.promptPicker(f.principal, base),
    second = await library.promptPicker(f.principal, { ...base, offset: 50 });
  expect(first.items).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  expect(second.items).toHaveLength(5);
  expect(second.hasMore).toBe(false);
  expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(
    55,
  );
  expect(first.groups).toEqual(["A组", "B组"]);
  const found = await library.promptPicker(f.principal, {
    ...base,
    search: "完整正文55",
    group: "B组",
  });
  expect(found.items.map((p) => p.title)).toEqual(["提示词55"]);
  expect(found.groups).toEqual(["A组", "B组"]);
  expect(
    (
      await library.promptPicker(f.principal, {
        ...base,
        search: "完整正文55",
        group: "A组",
      })
    ).items,
  ).toHaveLength(0);
  const user = await f.service.createUser(f.principal, "picker-member");
  await finishTemporaryPassword(f.service, user);
  const login = await f.service.login("picker-member", testPassword),
    member = (await f.service.authenticate(login.token)).user;
  expect((await library.promptPicker(member, base)).items).toHaveLength(0);
  expect((await library.promptPicker(member, base)).groups).toHaveLength(0);
  const input = {
    id: "featured-picker-test",
    title: "精选测试",
    category: "新增分类",
    prompt: "推荐的完整正文",
    published: false,
    featured: true,
    revision: 0,
  };
  const saved = await library.savePrompt(f.principal, input);
  expect(
    (
      await library.promptPicker(member, { ...base, source: "recommended" })
    ).items.some((p) => p.id === saved.id),
  ).toBe(false);
  const published = await library.savePrompt(f.principal, {
    ...input,
    revision: saved.revision,
    published: true,
  });
  const listed = await library.promptPicker(member, {
    ...base,
    source: "recommended",
    group: "新增分类",
    search: "完整正文",
  });
  expect(listed.items.map((p) => p.id)).toEqual([saved.id]);
  const { featured, ...legacyInput } = {
    ...input,
    published: true,
    revision: published.revision,
  };
  const unchanged = await library.savePrompt(f.principal, legacyInput);
  expect(unchanged.featured).toBe(true);
  await library.savePrompt(f.principal, {
    ...input,
    published: true,
    featured: false,
    revision: unchanged.revision,
  });
  const unfeatured = await library.promptPicker(member, {
    ...base,
    source: "recommended",
  });
  expect(unfeatured.items.some((p) => p.id === saved.id)).toBe(true);
  expect(unfeatured.items.findIndex((p) => p.id === saved.id)).toBeGreaterThan(
    2,
  );
  await f.pool.query(
    "INSERT INTO prompt_templates(id,title,category,prompt,published,featured) SELECT 'picker-public-'||n,'公共分页'||n,'分页分类','公共完整正文'||n,true,n<=2 FROM generate_series(1,60) n",
  );
  const publicFirst = await library.promptPicker(member, {
    ...base,
    source: "recommended",
    group: "分页分类",
  });
  const publicSecond = await library.promptPicker(member, {
    ...base,
    source: "recommended",
    group: "分页分类",
    offset: 50,
  });
  expect(publicFirst.items).toHaveLength(50);
  expect(publicFirst.hasMore).toBe(true);
  expect(publicFirst.items.slice(0, 2).map((p) => p.id)).toEqual([
    "picker-public-1",
    "picker-public-2",
  ]);
  expect(publicSecond.items).toHaveLength(10);
  expect(publicSecond.hasMore).toBe(false);
  expect(
    new Set([...publicFirst.items, ...publicSecond.items].map((p) => p.id))
      .size,
  ).toBe(60);
  expect((await f.repo.usage(f.principal)).used).toBe(0);
});
