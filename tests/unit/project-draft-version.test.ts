import { expect, it } from "vitest";
import {
  emptyProjectDraft,
  projectDraftDocument,
  projectDraftSave,
} from "@tuyile/contracts";
import { randomUUID } from "node:crypto";
it("normalizes unversioned drafts to v1 and writes a declared format version", () => {
  const { schemaVersion, ...legacy } = emptyProjectDraft();
  legacy.direct.prompt = "existing content";
  expect(projectDraftDocument.parse(legacy)).toEqual({
    schemaVersion: 1,
    ...legacy,
  });
  expect(schemaVersion).toBe(1);
  expect(
    projectDraftSave.parse({
      revision: 0,
      requestKey: randomUUID(),
      document: legacy,
    }).document.schemaVersion,
  ).toBe(1);
});
it("rejects unknown versions and unexpected fields instead of dropping data", () => {
  for (const schemaVersion of [0, 2, "1", null])
    expect(
      projectDraftDocument.safeParse({ ...emptyProjectDraft(), schemaVersion })
        .success,
    ).toBe(false);
  expect(
    projectDraftDocument.safeParse({
      ...emptyProjectDraft(),
      futureInput: "do not erase",
    }).success,
  ).toBe(false);
});

it("preserves optional complexity and keeps legacy drafts unchanged", () => {
  const legacy = emptyProjectDraft();
  expect(projectDraftDocument.parse(legacy).direct.settings).not.toHaveProperty(
    "complexity",
  );
  legacy.direct.settings.complexity = "low";
  legacy.agent.settings.complexity = "high";
  const saved = projectDraftDocument.parse(legacy);
  expect(saved.direct.settings.complexity).toBe("low");
  expect(saved.agent.settings.complexity).toBe("high");
});
