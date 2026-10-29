import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasService } from "@tuyile/core";
import { PgCanvasStore } from "@tuyile/infrastructure";
import { emptyCanvas, type CanvasSave } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
let f: Awaited<ReturnType<typeof imageFixture>>, s: CanvasService;
beforeEach(async () => {
  f = await imageFixture();
  s = new CanvasService(new PgCanvasStore(f.pool));
});
afterEach(async () => {
  await f?.cleanup();
});
const save = (extra: Partial<CanvasSave> = {}): CanvasSave => ({
  revision: 0,
  requestKey: randomUUID(),
  document: emptyCanvas(),
  placements: [],
  ...extra,
});
it("atomically saves revision and references, rejects stale writers and recovers ambiguous saves", async () => {
  const asset = await f.creation.upload(f.principal, f.png);
  const input = save({
    document: {
      ...emptyCanvas(),
      nodes: [
        {
          id: randomUUID(),
          kind: "image",
          assetId: asset.id,
          label: "synthetic",
          x: 0,
          y: 0,
          width: 200,
          height: 200,
        },
      ],
    },
  });
  expect((await s.save(f.principal, f.project.id, input)).revision).toBe(1);
  expect((await s.save(f.principal, f.project.id, input)).revision).toBe(1);
  await expect(s.save(f.principal, f.project.id, save())).rejects.toMatchObject(
    { code: "CANVAS_CONFLICT" },
  );
  await expect(
    f.creation.deleteAsset(f.principal, asset.id),
  ).rejects.toMatchObject({ code: "ASSET_REFERENCED" });
  await s.save(f.principal, f.project.id, save({ revision: 1 }));
  await f.creation.deleteAsset(f.principal, asset.id);
  await expect(
    s.save(f.principal, f.project.id, {
      ...input,
      revision: 2,
      requestKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
  expect((await s.load(f.principal, f.project.id)).revision).toBe(2);
});
it("persists output receipts independently of deleted nodes and copies conflicts without changing the source", async () => {
  const task = await f.creation.submit(f.principal, f.input());
  await f.worker();
  const done = await f.done(task.id);
  const output = done.outputs[0];
  expect(await s.pending(f.principal, f.project.id)).toHaveLength(1);
  await s.save(
    f.principal,
    f.project.id,
    save({ placements: [output.outputId] }),
  );
  expect(await s.pending(f.principal, f.project.id)).toEqual([]);
  await s.save(f.principal, f.project.id, save({ revision: 1 }));
  expect(await s.pending(f.principal, f.project.id)).toEqual([]);
  const copy = save({
    document: { ...emptyCanvas(), viewport: { x: 40, y: 0, zoom: 1 } },
  });
  const project = await s.copy(f.principal, f.project.id, copy);
  expect((await s.copy(f.principal, f.project.id, copy)).id).toBe(project.id);
  expect((await s.load(f.principal, project.id)).document.viewport.x).toBe(40);
  expect((await s.load(f.principal, f.project.id)).document.viewport.x).toBe(0);
});
it("keeps source lineage after task pins release and denies cross-workspace document access", async () => {
  const ref = await f.creation.upload(f.principal, f.png);
  const task = await f.creation.submit(
    f.principal,
    f.input({ referenceIds: [ref.id] }),
  );
  await f.worker();
  await f.done(task.id);
  expect((await s.pending(f.principal, f.project.id))[0].sourceIds).toEqual([
    ref.id,
  ]);
  const other = await f.service.createUser(f.principal, "canvas-member");
  await expect(
    s.load(
      { ...f.principal, id: other.user.id, workspaceId: randomUUID() },
      f.project.id,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
