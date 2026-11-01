import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  canvasSave,
  CANVAS_REQUEST_MAX_BYTES,
  emptyCanvas,
} from "@tuyile/contracts";
it("fits the full canvas contract including worst-case JSON string escaping", () => {
  const input = canvasSave.parse({
    revision: Number.MAX_SAFE_INTEGER,
    requestKey: randomUUID(),
    placements: Array.from({ length: 1000 }, () => randomUUID()),
    document: {
      ...emptyCanvas(),
      nodes: Array.from({ length: 1000 }, () => ({
        id: randomUUID(),
        kind: "text",
        label: "\u0001".repeat(100),
        text: "\u0001".repeat(4000),
        tone: "yellow",
        x: -99999.99999999999,
        y: -99999.99999999999,
        width: 9999.999999999998,
        height: 9999.999999999998,
        parentId: undefined,
      })),
    },
  });
  const bytes = Buffer.byteLength(JSON.stringify(input));
  expect(bytes).toBeGreaterThan((24 * 1024 * 1024) / 1.1);
  expect(bytes).toBeLessThan(CANVAS_REQUEST_MAX_BYTES);
});
