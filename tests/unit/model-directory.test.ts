import { expect, it } from "vitest";
import { CompatibleModelDirectory } from "@tuyile/infrastructure";
import { poolPublication } from "@tuyile/contracts";
const config = {
  mode: "openai" as const,
  baseUrl: "https://models.example/v1",
  apiKey: "synthetic-directory-key",
  versionId: "synthetic",
};
it("reads only bounded model metadata with bearer auth and no redirect or generation calls", async () => {
  const calls: unknown[] = [];
  const d = new CompatibleModelDirectory(false, async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }],
    });
  });
  expect(await d.list(config, AbortSignal.timeout(1000))).toEqual([
    "model-a",
    "model-b",
  ]);
  expect(calls).toMatchObject([
    {
      url: "https://models.example/v1/models",
      init: {
        method: "GET",
        redirect: "error",
        headers: { Authorization: "Bearer synthetic-directory-key" },
      },
    },
  ]);
});
it("rejects bad, too large, denied and unavailable directories without leaking upstream bodies", async () => {
  for (const response of [
    Response.json({ data: [{ id: "bad\nmodel" }] }),
    Response.json({ error: { secret: "never-return" } }, { status: 401 }),
    new Response("x", { headers: { "content-length": "1048577" } }),
    Response.json({ data: [] }),
  ]) {
    const d = new CompatibleModelDirectory(false, async () => response);
    await expect(
      d.list(config, AbortSignal.timeout(1000)),
    ).rejects.toHaveProperty(
      "code",
      expect.stringMatching(/^MODEL_DIRECTORY_/),
    );
  }
  const d = new CompatibleModelDirectory(false, async () => {
    throw Error("private-network-detail");
  });
  await expect(
    d.list(config, AbortSignal.timeout(1000)),
  ).rejects.toHaveProperty("code", "MODEL_DIRECTORY_UNAVAILABLE");
});
it("requires a unique enabled default in each published nonempty pool", () => {
  const entry = {
    id: "20000000-0000-4000-8000-000000000001",
    serviceId: "10000000-0000-4000-8000-000000000001",
    modelId: "chat",
    kind: "conversation",
    enabled: true,
    isDefault: false,
    conversation: {
      supportsImages: true,
      responseMode: "json_object",
      maxOutputTokens: 4096,
      maxInputCharacters: 32000,
    },
  };
  expect(
    poolPublication.safeParse({ revision: 0, entries: [entry] }).success,
  ).toBe(false);
  expect(
    poolPublication.safeParse({
      revision: 0,
      entries: [{ ...entry, isDefault: true }],
    }).success,
  ).toBe(true);
  expect(
    poolPublication.safeParse({
      revision: 0,
      entries: [
        { ...entry, isDefault: true },
        {
          ...entry,
          id: "20000000-0000-4000-8000-000000000002",
          isDefault: true,
        },
      ],
    }).success,
  ).toBe(false);
});
