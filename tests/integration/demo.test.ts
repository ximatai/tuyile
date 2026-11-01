import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CanvasService,
  DemoService,
  LibraryService,
  type ImageFiles,
} from "@tuyile/core";
import {
  PgCanvasStore,
  PgDemoStore,
  PgLibraryStore,
} from "@tuyile/infrastructure";
import { emptyCanvas, type Principal } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
let f: Awaited<ReturnType<typeof imageFixture>>,
  canvas: CanvasService,
  demo: DemoService;
beforeEach(async () => {
  f = await imageFixture();
  canvas = new CanvasService(new PgCanvasStore(f.pool));
  demo = new DemoService(new PgDemoStore(f.pool), f.files);
});
afterEach(async () => {
  await f?.cleanup();
});
async function source() {
  await f.worker();
  const outputs = [];
  for (const name of ["A · brand", "B · product", "C · result"]) {
    const t = await f.creation.submit(
      f.principal,
      f.input({
        prompt: `Synthetic example ${name}`,
        referenceIds: outputs.length === 2 ? outputs.map((a) => a.id) : [],
      }),
    );
    const done = await f.done(t.id);
    expect(done.state).toBe("succeeded");
    outputs.push(done.outputs[0]);
  }
  await canvas.save(f.principal, f.project.id, {
    revision: 0,
    requestKey: randomUUID(),
    placements: outputs.map((a) => a.outputId),
    document: {
      ...emptyCanvas(),
      nodes: outputs.map((a, i) => ({
        id: randomUUID(),
        kind: "image",
        assetId: a.id,
        label: ["A · brand", "B · product", "C · result"][i],
        x: i === 2 ? 400 : 40,
        y: i === 1 ? 340 : 40,
        width: 220,
        height: 220,
      })),
    },
  });
  return outputs;
}
async function member(name = "member-" + randomUUID().slice(0, 8)) {
  const issued = await f.service.createUser(f.principal, name);
  const first = await f.service.login(name, issued.temporaryPassword);
  const temporary = (await f.service.authenticate(first.token)).user;
  const password = "Synthetic!" + randomUUID();
  await f.service.changePassword(temporary, issued.temporaryPassword, password);
  const session = await f.service.login(name, password);
  return {
    principal: (await f.service.authenticate(session.token)).user,
    issued,
  };
}
it("copies the approved snapshot privately with example prompts/lineage but no calls, tasks or usage, and never reseeds a deleted copy", async () => {
  const old = await member();
  const originals = await source();
  const input = {
    projectId: f.project.id,
    requestKey: randomUUID(),
    starterPrompt: "Synthetic editable starter",
  };
  const published = await demo.publish(f.principal, input);
  expect(await demo.publish(f.principal, input)).toEqual(published);
  await expect(
    demo.publish(f.principal, { ...input, starterPrompt: "Different input" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await demo.initialize(old.principal)).toEqual({ state: "none" });
  const a = await member(),
    b = await member();
  const ready = await demo.initialize(a.principal, a.principal.id, true);
  expect(ready.state).toBe("ready");
  expect(ready.shouldOpen).toBe(true);
  const again = await demo.initialize(a.principal, a.principal.id, true);
  expect(again.projectId).toBe(ready.projectId);
  expect(again.shouldOpen).toBe(false);
  await demo.initialize(b.principal);
  const document = await canvas.load(a.principal, ready.projectId!);
  expect(document.document.nodes).toHaveLength(3);
  const meta = (await demo.project(a.principal, ready.projectId!))!;
  expect(meta.images.map((i) => i.prompt).sort()).toEqual([
    "Synthetic example A · brand",
    "Synthetic example B · product",
    "Synthetic example C · result",
  ]);
  expect(
    meta.images.every((i) => !originals.some((a) => a.id === i.assetId)),
  ).toBe(true);
  expect(
    meta.images.find((i) => i.label.startsWith("C"))!.sourceIds.sort(),
  ).toEqual(
    meta.images
      .filter((i) => !i.sourceIds.length)
      .map((i) => i.assetId)
      .sort(),
  );
  const draft = await canvas.loadDraft(a.principal, ready.projectId!);
  expect(draft.document.direct.prompt).toBe("Synthetic editable starter");
  expect(draft.document.direct.settings.modelKey).toBe("");
  await canvas.saveDraft(a.principal, ready.projectId!, {
    revision: draft.revision,
    requestKey: randomUUID(),
    document: {
      ...draft.document,
      direct: { ...draft.document.direct, prompt: "Changed by member" },
    },
  });
  expect(
    (await demo.project(a.principal, ready.projectId!))!.images,
  ).toHaveLength(3);
  expect(
    (await canvas.sources(a.principal, ready.projectId!)).find(
      (s) => s.sourceIds.length === 2,
    ),
  ).toBeDefined();
  expect(await f.creation.tasks(a.principal)).toHaveLength(0);
  const usage = await f.creation.usage(a.principal);
  expect(usage.used).toBe(0);
  expect(usage.held).toBe(0);
  expect(usage.attempts).toBe(0);
  expect(usage.storageUsed).toBeGreaterThan(0);
  expect(usage.storageReserved).toBe(0);
  for (const i of meta.images) {
    expect(
      (await f.creation.bytes(a.principal, i.assetId)).bytes.length,
    ).toBeGreaterThan(0);
    await expect(
      f.creation.bytes(b.principal, i.assetId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.creation.bytes(f.principal, i.assetId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  await expect(
    demo.project(b.principal, ready.projectId!),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(demo.status(a.principal, b.principal.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(demo.publish(a.principal, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const library = new LibraryService(new PgLibraryStore(f.pool));
  expect((await library.assets(a.principal)).map((i) => i.origin)).toEqual([
    "demo",
    "demo",
    "demo",
  ]);
  expect(
    await library.references(a.principal, meta.images[0].assetId),
  ).toContainEqual({
    kind: "demo",
    id: ready.projectId,
    label: "示例创作记录",
    projectId: ready.projectId,
  });
  expect(await library.references(f.principal, originals[0].id)).toContainEqual(
    {
      kind: "demo",
      id: published.id,
      label: "新用户示例模板",
      projectId: null,
    },
  );
  await expect(
    f.creation.deleteAsset(f.principal, originals[0].id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  const copied = await canvas.copy(a.principal, ready.projectId!, {
    revision: document.revision,
    requestKey: randomUUID(),
    document: document.document,
    placements: [],
  });
  expect((await demo.project(a.principal, copied.id))?.images).toHaveLength(3);
  await canvas.removeProject(a.principal, copied.id);
  await canvas.removeProject(a.principal, ready.projectId!);
  expect(
    (await library.assets(a.principal)).every((i) => i.origin === "demo"),
  ).toBe(true);
  expect(await demo.initialize(a.principal, a.principal.id, true)).toEqual({
    state: "removed",
  });
  expect(await f.service.projects(a.principal)).toHaveLength(0);
});
it("keeps account creation successful when copying fails and safely retries a durable per-user plan without duplicates", async () => {
  await source();
  await demo.publish(f.principal, {
    projectId: f.project.id,
    requestKey: randomUUID(),
  });
  const issued = await f.service.createUser(
    f.principal,
    "retry-" + randomUUID().slice(0, 8),
  );
  let writes = 0;
  const flaky: ImageFiles = {
    inspect: (b) => f.files.inspect(b),
    read: (a, p) => f.files.read(a, p),
    remove: (k) => f.files.remove(k),
    freeSpace: () => f.files.freeSpace(),
    write: async (k, i) => {
      if (++writes === 2) throw Error("Synthetic disk failure");
      await f.files.write(k, i);
    },
  };
  const first = await new DemoService(
    new PgDemoStore(f.pool),
    flaky,
  ).initialize(f.principal, issued.user.id);
  expect(first.state).toBe("failed");
  expect(
    (await f.service.login(issued.user.username, issued.temporaryPassword))
      .token,
  ).toBeTruthy();
  const rows = await f.pool.query(
    "SELECT id FROM tuyile.projects WHERE workspace_id=(SELECT id FROM tuyile.workspaces WHERE owner_id=$1)",
    [issued.user.id],
  );
  expect(rows.rowCount).toBe(0);
  const ready = await demo.initialize(f.principal, issued.user.id);
  expect(ready.state).toBe("ready");
  expect((await demo.initialize(f.principal, issued.user.id)).projectId).toBe(
    ready.projectId,
  );
  const assets = await f.pool.query(
    "SELECT id,file_key FROM tuyile.image_assets WHERE user_id=$1",
    [issued.user.id],
  );
  expect(assets.rowCount).toBe(3);
  expect(new Set(assets.rows.map((a) => a.file_key)).size).toBe(3);
  const policy = (
    await f.pool.query(
      "SELECT storage_reserved FROM tuyile.image_policies WHERE user_id=$1",
      [issued.user.id],
    )
  ).rows[0];
  expect(Number(policy.storage_reserved)).toBe(0);
});
it("serializes concurrent retries, pins the template version at account creation, and excludes later source edits", async () => {
  await source();
  const first = await demo.publish(f.principal, {
    projectId: f.project.id,
    requestKey: randomUUID(),
    starterPrompt: "Version one",
  });
  const a = await member();
  await demo.publish(f.principal, {
    projectId: f.project.id,
    requestKey: randomUUID(),
    starterPrompt: "Version two",
  });
  const results = await Promise.all([
    demo.initialize(a.principal),
    demo.initialize(a.principal),
  ]);
  expect(results.some((r) => r.state === "ready")).toBe(true);
  const ready = await demo.status(a.principal);
  expect(ready.state).toBe("ready");
  expect((await demo.project(a.principal, ready.projectId!))!.templateId).toBe(
    first.id,
  );
  expect(
    (await canvas.loadDraft(a.principal, ready.projectId!)).document.direct
      .prompt,
  ).toBe("Version one");
  expect(await f.service.projects(a.principal)).toHaveLength(1);
  const snap = await canvas.load(f.principal, f.project.id);
  await canvas.save(f.principal, f.project.id, {
    revision: snap.revision,
    requestKey: randomUUID(),
    placements: [],
    document: { ...snap.document, nodes: [] },
  });
  await expect(
    demo.publish(f.principal, {
      projectId: f.project.id,
      requestKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "DEMO_SOURCE_INVALID" });
  expect(
    (await demo.project(a.principal, ready.projectId!))!.images,
  ).toHaveLength(3);
});
