import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasService, LibraryService } from "@tuyile/core";
import { PgCanvasStore, PgLibraryStore } from "@tuyile/infrastructure";
import { emptyProjectDraft, type ProjectDraftSave } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture";
import { finishTemporaryPassword, testPassword } from "../test-database";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof imageFixture>>, s: CanvasService;
beforeEach(async () => {
  f = await imageFixture();
  s = new CanvasService(new PgCanvasStore(f.pool));
});
afterEach(async () => {
  await f?.cleanup();
});
const input = (extra: Partial<ProjectDraftSave> = {}): ProjectDraftSave => ({
  revision: 0,
  requestKey: randomUUID(),
  document: emptyProjectDraft(),
  ...extra,
});
it("stores both input modes and settings without executing, validates versions and safely retries lost responses", async () => {
  const asset = await f.creation.upload(f.principal, f.png),
    document = emptyProjectDraft();
  document.direct.prompt = "未提交的创作需求";
  document.direct.style = { name: "未完成风格", text: "" };
  document.direct.settings.modelKey = "test-image";
  document.agent.prompt = "未提交规划";
  document.agent.conversationModel = "saved-model";
  document.referenceIds = [asset.id];
  document.mode = "agent";
  expect((await s.loadDraft(f.principal, f.project.id)).revision).toBe(0);
  const request = input({ document });
  const saved = await s.saveDraft(f.principal, f.project.id, request);
  expect(await s.loadDraft(f.principal, f.project.id)).toEqual(saved);
  expect((await s.saveDraft(f.principal, f.project.id, request)).revision).toBe(
    1,
  );
  await expect(
    s.saveDraft(f.principal, f.project.id, {
      ...request,
      document: emptyProjectDraft(),
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const race = await Promise.allSettled([
    s.saveDraft(f.principal, f.project.id, input({ revision: 1 })),
    s.saveDraft(f.principal, f.project.id, input({ revision: 1 })),
  ]);
  expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (race.find((r) => r.status === "rejected") as PromiseRejectedResult).reason
      .code,
  ).toBe("DRAFT_CONFLICT");
  expect(await f.repo.tasks(f.principal)).toHaveLength(0);
  expect((await f.repo.usage(f.principal)).used).toBe(0);
});
it("protects draft assets until removed or project deletion, with discoverable references", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const document = { ...emptyProjectDraft(), referenceIds: [asset.id] };
  await s.saveDraft(f.principal, f.project.id, input({ document }));
  await expect(
    f.creation.deleteAsset(f.principal, asset.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  const library = new LibraryService(new PgLibraryStore(f.pool));
  expect(await library.references(f.principal, asset.id)).toContainEqual({
    kind: "draft",
    id: f.project.id,
    label: "创作草稿",
    projectId: f.project.id,
  });
  await s.saveDraft(f.principal, f.project.id, input({ revision: 1 }));
  await f.creation.deleteAsset(f.principal, asset.id);
  await expect(
    s.saveDraft(f.principal, f.project.id, input({ revision: 2, document })),
  ).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
  expect((await s.loadDraft(f.principal, f.project.id)).revision).toBe(2);
  const another = await f.creation.upload(f.principal, f.png);
  await s.saveDraft(
    f.principal,
    f.project.id,
    input({
      revision: 2,
      document: { ...document, referenceIds: [another.id] },
    }),
  );
  await s.removeProject(f.principal, f.project.id);
  await f.creation.deleteAsset(f.principal, another.id);
  await expect(s.loadDraft(f.principal, f.project.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    (
      await f.pool.query(
        "SELECT 1 FROM project_creation_drafts WHERE project_id=$1",
        [f.project.id],
      )
    ).rowCount,
  ).toBe(0);
});
it("serializes reference saves against image deletion", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const race = await Promise.allSettled([
    s.saveDraft(
      f.principal,
      f.project.id,
      input({ document: { ...emptyProjectDraft(), referenceIds: [asset.id] } }),
    ),
    f.creation.deleteAsset(f.principal, asset.id),
  ]);
  expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(["ASSET_REFERENCED", "REFERENCE_UNAVAILABLE"]).toContain(
    (race.find((r) => r.status === "rejected") as PromiseRejectedResult).reason
      .code,
  );
});
it("enforces project ownership and HTTP schemas including large Unicode drafts", async () => {
  const created = await f.service.createUser(f.principal, "draft-member");
  await finishTemporaryPassword(f.service, created, testPassword);
  const login = await f.service.login("draft-member", testPassword),
    other = (await f.service.authenticate(login.token)).user;
  await expect(s.loadDraft(other, f.project.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(s.saveDraft(other, f.project.id, input())).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
  const app = createApp(
    f.service,
    f.store,
    { origin: "http://127.0.0.1:5180", production: false },
    async () => {},
    undefined,
    f.creation,
    undefined,
    s,
  );
  const session = await f.service.authenticate(f.login.token),
    headers = {
      cookie: `tuyile_session=${f.login.token}`,
      Origin: "http://127.0.0.1:5180",
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    };
  const document = emptyProjectDraft();
  document.direct.prompt = "图".repeat(12000);
  document.agent.prompt = "图".repeat(12000);
  expect(
    (
      await app.request(`/api/projects/${f.project.id}/draft`, {
        method: "POST",
        headers,
        body: JSON.stringify(input({ document })),
      })
    ).status,
  ).toBe(200);
  document.direct.prompt += "图";
  expect(
    (
      await app.request(`/api/projects/${f.project.id}/draft`, {
        method: "POST",
        headers,
        body: JSON.stringify(input({ revision: 1, document })),
      })
    ).status,
  ).toBe(400);
  const anonymous = await app.request(`/api/projects/${f.project.id}/draft`);
  expect(anonymous.status).toBe(401);
});

it("reads legacy drafts without rewriting them and recognizes their previously accepted save keys", async () => {
  const { createHash } = await import("node:crypto"),
    { projectDraftSave } = await import("@tuyile/contracts");
  const { schemaVersion, ...legacy } = emptyProjectDraft();
  legacy.direct.prompt = "legacy saved input";
  const legacyRequest = {
    revision: 0,
    requestKey: randomUUID(),
    document: legacy,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(legacyRequest))
    .digest("hex");
  await f.pool.query(
    "INSERT INTO project_creation_drafts(workspace_id,project_id,revision,document,request_key,request_hash) VALUES($1,$2,1,$3,$4,$5)",
    [
      f.principal.workspaceId,
      f.project.id,
      legacy,
      legacyRequest.requestKey,
      hash,
    ],
  );
  expect((await s.loadDraft(f.principal, f.project.id)).document).toMatchObject(
    { schemaVersion: 1, direct: { prompt: "legacy saved input" } },
  );
  expect(
    (
      await f.pool.query(
        "SELECT document FROM project_creation_drafts WHERE project_id=$1",
        [f.project.id],
      )
    ).rows[0].document.schemaVersion,
  ).toBeUndefined();
  expect(
    (
      await s.saveDraft(
        f.principal,
        f.project.id,
        projectDraftSave.parse(legacyRequest),
      )
    ).revision,
  ).toBe(1);
  await expect(
    s.saveDraft(
      f.principal,
      f.project.id,
      projectDraftSave.parse({
        ...legacyRequest,
        document: {
          ...legacy,
          direct: { ...legacy.direct, prompt: "different body" },
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await s.saveDraft(
    f.principal,
    f.project.id,
    input({ revision: 1, document: { schemaVersion, ...legacy } }),
  );
  expect(
    (
      await f.pool.query(
        "SELECT document FROM project_creation_drafts WHERE project_id=$1",
        [f.project.id],
      )
    ).rows[0].document.schemaVersion,
  ).toBe(1);
  await f.pool.query(
    "UPDATE project_creation_drafts SET document=jsonb_set(document,'{schemaVersion}','2'::jsonb) WHERE project_id=$1",
    [f.project.id],
  );
  await expect(s.loadDraft(f.principal, f.project.id)).rejects.toMatchObject({
    code: "DRAFT_VERSION_UNSUPPORTED",
  });
});
