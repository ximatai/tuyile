import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasService } from "@tuyile/core";
import { PgCanvasStore } from "@tuyile/infrastructure";
import {
  imageCapabilityDefaults,
  emptyProjectDraft,
  imageAnnotation,
} from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
it("persists editing and pending submission snapshots, pins originals and only charges saved modifications", async () => {
  const f = await imageFixture();
  try {
    const canvas = new CanvasService(new PgCanvasStore(f.pool));
    const base = await f.creation.upload(f.principal, f.png);
    const annotation = imageAnnotation.parse({
      version: 1,
      strokes: [
        {
          kind: "ellipse",
          points: [
            [1000, 1000],
            [8000, 8000],
          ],
        },
      ],
    });
    const input = f.input({
      referenceIds: [base.id],
      annotation,
      editSession: true,
      preserveRequirements: "保留主体",
    });
    await expect(f.creation.submit(f.principal, input)).rejects.toMatchObject({
      code: "MODEL_CAPABILITY_UNSUPPORTED",
    });
    expect((await f.creation.usage(f.principal)).held).toBe(0);
    await f.creation.saveProvider(f.principal, {
      mode: "fake",
      baseUrl: "",
      models: ["test-image"],
      preserveKey: false,
      capabilities: [
        { ...imageCapabilityDefaults("test-image"), markup: true },
      ],
    });
    const document = emptyProjectDraft();
    document.edit = {
      baseAssetId: base.id,
      prompt: input.prompt,
      settings: {
        modelKey: input.model,
        width: 256,
        height: 256,
        quality: "medium",
        format: "png",
        count: 1,
      },
      annotation,
      pendingInput: input,
    };
    const saved = await canvas.saveDraft(f.principal, f.project.id, {
      revision: 0,
      requestKey: randomUUID(),
      document,
    });
    expect(
      (await canvas.loadDraft(f.principal, f.project.id)).document.edit
        ?.pendingInput?.requestKey,
    ).toBe(input.requestKey);
    await expect(f.creation.delete(f.principal, base.id)).rejects.toMatchObject(
      { code: "ASSET_REFERENCED" },
    );
    const accepted = await f.creation.submit(f.principal, input);
    expect((await f.creation.submit(f.principal, input)).id).toBe(accepted.id);
    await f.worker();
    const result = await f.done(accepted.id);
    expect(result.state).toBe("succeeded");
    expect(result.settings?.annotation).toEqual(annotation);
    expect(result.finalPrompt).toContain("保留主体");
    expect((await f.creation.usage(f.principal)).used).toBe(1);
    document.edit = undefined;
    await canvas.saveDraft(f.principal, f.project.id, {
      revision: saved.revision,
      requestKey: randomUUID(),
      document,
    });
    expect(await f.creation.tasks(f.principal, f.project.id)).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
