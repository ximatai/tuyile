import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasService, LibraryService, promptTemplates } from "@tuyile/core";
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
    prompt: promptTemplates[0].prompt,
  });
  expect((await library.favorites(f.principal))[0].prompt).toBe(
    promptTemplates[0].prompt,
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
  await f.service.redeem(created.token, testPassword, "activate");
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
