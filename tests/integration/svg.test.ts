import { CanvasService } from "@tuyile/core";
import { PgCanvasStore } from "@tuyile/infrastructure";
import { emptyCanvas } from "@tuyile/contracts";
import { it, expect } from "vitest";
import { imageFixture } from "../creation-fixture.js";
import { imageCapabilityDefaults } from "@tuyile/contracts";
import {
  PgAdministrationStore,
  CompatibleImageProvider,
} from "@tuyile/infrastructure";
import { AdministrationService } from "@tuyile/core";
it("creates a private vector with safe preview, idempotent raster lineage, quotas and explicit local failure settlement", async () => {
  const f = await imageFixture();
  try {
    await f.creation.saveProvider(f.principal, {
      mode: "fake",
      baseUrl: "",
      models: ["test-image"],
      preserveKey: false,
      capabilities: [
        {
          ...imageCapabilityDefaults("test-image"),
          formats: ["png", "svg"],
          svgAuthor: { mode: "service-default" },
        },
      ],
    });
    await expect(
      f.creation.submit(f.principal, f.input({ format: "svg", count: 2 })),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_UNSUPPORTED" });
    const task = await f.creation.submit(
      f.principal,
      f.input({ format: "svg" }),
    );
    await f.worker();
    const result = await f.done(task.id);
    expect(result.state).toBe("succeeded");
    expect(result.outputs[0]!.mime).toBe("image/svg+xml");
    const id = result.outputs[0]!.id;
    expect((await f.creation.bytes(f.principal, id)).asset.mime).toBe(
      "image/webp",
    );
    expect(
      Buffer.from(
        (await f.creation.bytes(f.principal, id, false, true)).bytes,
      ).toString(),
    ).toContain("<svg");
    const other = { ...f.principal, workspaceId: crypto.randomUUID() };
    await expect(
      f.creation.bytes(other, id, false, true),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.creation.submit(f.principal, f.input({ referenceIds: [id] })),
    ).rejects.toMatchObject({ code: "REFERENCE_UNAVAILABLE" });
    const svg = (await f.creation.bytes(f.principal, id, false, true)).bytes;
    const revisionBytes = Buffer.from(
      Buffer.from(svg).toString().replace("#ffffff", "#e8b844"),
    );
    const beforeRevision = await f.creation.usage(f.principal);
    await expect(
      f.creation.upload(f.principal, revisionBytes),
    ).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
    await expect(
      f.creation.importSvgRevision(other, id, revisionBytes),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      f.creation.importSvgRevision(
        f.principal,
        id,
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><script/></svg>',
        ),
      ),
    ).rejects.toMatchObject({ code: "SVG_INVALID_OR_UNSUPPORTED" });
    const revision = await f.creation.importSvgRevision(
      f.principal,
      id,
      revisionBytes,
    );
    expect(revision).toMatchObject({ mime: "image/svg+xml", revisionOf: id });
    expect(
      (await f.creation.importSvgRevision(f.principal, id, revisionBytes)).id,
    ).toBe(revision.id);
    expect(await f.creation.svgRevisions(f.principal, id)).toMatchObject([
      { id: revision.id },
    ]);
    expect((await f.creation.bytes(f.principal, revision.id)).asset.mime).toBe(
      "image/webp",
    );
    expect(
      Buffer.from(
        (await f.creation.bytes(f.principal, revision.id, false, true)).bytes,
      ),
    ).toEqual(revisionBytes);
    expect(
      (await f.creation.bytes(f.principal, id, false, true)).bytes,
    ).toEqual(svg);
    const afterRevision = await f.creation.usage(f.principal);
    expect(afterRevision).toMatchObject({
      used: beforeRevision.used,
      attempts: beforeRevision.attempts,
      held: beforeRevision.held,
    });
    expect(afterRevision.storageUsed - beforeRevision.storageUsed).toBe(
      revision.bytes + revision.previewBytes,
    );
    await expect(f.creation.delete(f.principal, id)).rejects.toMatchObject({
      code: "ASSET_REFERENCED",
    });
    await f.creation.delete(f.principal, revision.id);
    const copy = await f.creation.rasterCopy(f.principal, id);
    expect(copy.mime).toBe("image/png");
    expect(copy.derivedFrom).toBe(id);
    expect((await f.creation.rasterCopy(f.principal, id)).id).toBe(copy.id);
    expect((await f.creation.usage(f.principal)).used).toBe(1);
    await expect(f.creation.delete(f.principal, id)).rejects.toMatchObject({
      code: "ASSET_REFERENCED",
    });
    const ledger = (
      await f.pool.query(
        "SELECT model_usage,reference_usd FROM image_attempts WHERE task_id=$1",
        [task.id],
      )
    ).rows[0];
    const report = await new AdministrationService(
      new PgAdministrationStore(f.pool),
      f.files,
    ).tokenUsage(f.principal, "today");
    expect(report.today).toMatchObject({
      calls: 1,
      inputTokens: 150,
      outputTokens: 356,
      pricedCalls: 0,
      unknownCachedUsage: 1,
    });
    expect(ledger.model_usage.svg.model).toBe("gpt-6.1-sol");
    expect(ledger.reference_usd).toBeNull();
    await f.creation.delete(f.principal, copy.id);
    await f.creation.delete(f.principal, id);
    expect((await f.creation.usage(f.principal)).storageUsed).toBe(0);
  } finally {
    await f.cleanup();
  }
});
it("rejects unsafe received SVG without another generation or held quota", async () => {
  const f = await imageFixture();
  try {
    await f.creation.saveProvider(f.principal, {
      mode: "fake",
      baseUrl: "",
      models: ["test-image"],
      preserveKey: false,
      capabilities: [
        {
          ...imageCapabilityDefaults("test-image"),
          formats: ["svg"],
          svgAuthor: { mode: "explicit", model: "gpt-6.1-sol" },
        },
      ],
    });
    let calls = 0;
    const task = await f.creation.submit(
      f.principal,
      f.input({ format: "svg" }),
    );
    await f.worker({
      async generate() {
        calls++;
        return Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><script/></svg>',
        );
      },
    });
    const result = await f.done(task.id);
    expect(result.state).toBe("failed");
    expect(result.pendingReview).toBe(false);
    expect(result.outputs).toHaveLength(0);
    expect(calls).toBe(1);
    const usage = await f.creation.usage(f.principal);
    expect(usage.used).toBe(0);
    expect(usage.held).toBe(0);
    expect(usage.storageReserved).toBe(0);
  } finally {
    await f.cleanup();
  }
});
it("shows vector-to-copy lineage and traces modified outputs to a visible vector when the copy is off canvas", async () => {
  const f = await imageFixture();
  try {
    await f.creation.saveProvider(f.principal, {
      mode: "fake",
      baseUrl: "",
      models: ["test-image"],
      preserveKey: false,
      capabilities: [
        {
          ...imageCapabilityDefaults("test-image"),
          formats: ["png", "svg"],
          svgAuthor: { mode: "service-default" },
        },
      ],
    });
    const created = await f.creation.submit(
      f.principal,
      f.input({ format: "svg" }),
    );
    await f.worker();
    const vector = (await f.done(created.id)).outputs[0]!.id;
    const copy = await f.creation.rasterCopy(f.principal, vector);
    const canvas = new CanvasService(new PgCanvasStore(f.pool));
    const node = (assetId: string, x: number) => ({
      id: crypto.randomUUID(),
      kind: "image" as const,
      assetId,
      label: "synthetic",
      x,
      y: 0,
      width: 256,
      height: 256,
    });
    const document = { ...emptyCanvas(), nodes: [node(vector, 0)] };
    const first = await canvas.save(f.principal, f.project.id, {
      revision: 0,
      requestKey: crypto.randomUUID(),
      document,
      placements: [],
    });
    const modified = await f.creation.submit(
      f.principal,
      f.input({ referenceIds: [copy.id] }),
    );
    const output = (await f.done(modified.id)).outputs[0]!.id;
    expect(
      (await canvas.pending(f.principal, f.project.id)).find(
        (o) => o.assetId === output,
      )?.sourceIds,
    ).toEqual([vector]);
    document.nodes.push(node(output, 600));
    const second = await canvas.save(f.principal, f.project.id, {
      revision: first.revision,
      requestKey: crypto.randomUUID(),
      document,
      placements: [],
    });
    expect(
      (await canvas.sources(f.principal, f.project.id)).find(
        (s) => s.assetId === output,
      )?.sourceIds,
    ).toEqual([vector]);
    document.nodes.push(node(copy.id, 300));
    await canvas.save(f.principal, f.project.id, {
      revision: second.revision,
      requestKey: crypto.randomUUID(),
      document,
      placements: [],
    });
    const sources = await canvas.sources(f.principal, f.project.id);
    expect(sources.find((s) => s.assetId === copy.id)?.sourceIds).toEqual([
      vector,
    ]);
    expect(sources.find((s) => s.assetId === output)?.sourceIds).toEqual([
      copy.id,
    ]);
  } finally {
    await f.cleanup();
  }
});
