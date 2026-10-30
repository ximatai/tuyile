import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ModelCatalogService,
  AgentService,
  ExtensionService,
} from "@tuyile/core";
import { CompatibleModelDirectory } from "@tuyile/infrastructure";
import { type PoolEntryInput, planningRequest } from "@tuyile/contracts";
import { imageFixture } from "../creation-fixture.js";
const dir = new CompatibleModelDirectory(true);
const image = (
  serviceId: string,
  modelId = "shared-image",
  isDefault = true,
): PoolEntryInput => ({
  id: randomUUID(),
  serviceId,
  modelId,
  kind: "image",
  enabled: true,
  isDefault,
  image: {
    model: modelId,
    generation: true,
    editing: true,
    maxReferences: 4,
    maxEdge: 2048,
    maxPixels: 4194304,
    sizes: [],
    qualities: ["medium"],
    formats: ["png"],
  },
});
const conversation = (
  serviceId: string,
  modelId = "chat",
  isDefault = true,
): PoolEntryInput => ({
  id: randomUUID(),
  serviceId,
  modelId,
  kind: "conversation",
  enabled: true,
  isDefault,
  conversation: {
    supportsImages: true,
    responseMode: "json_object",
    maxOutputTokens: 4096,
    maxInputCharacters: 32000,
  },
});
it("imports existing services without changing accepted bindings, deduplicates identical credentials and is idempotent", async () => {
  const f = await imageFixture();
  try {
    await new ExtensionService(f.creationStore).savePlanning(f.principal, {
      mode: "fake",
      baseUrl: "",
      model: "old-chat",
      preserveKey: false,
      supportsImages: true,
      responseMode: "json_object",
      maxOutputTokens: 4096,
      maxInputCharacters: 32000,
    });
    const accepted = await f.creation.submit(f.principal, f.input());
    const c = new ModelCatalogService(f.creationStore, dir);
    await c.bootstrap(f.principal);
    const first = await c.snapshot(f.principal);
    expect(first.services).toHaveLength(1);
    expect(first.entries.map((e) => e.kind).sort()).toEqual([
      "conversation",
      "image",
    ]);
    await c.bootstrap(f.principal);
    expect(await c.snapshot(f.principal)).toEqual(first);
    expect((await f.creation.task(f.principal, accepted.id)).id).toBe(
      accepted.id,
    );
    await expect(
      f.creation.saveProvider(f.principal, {
        mode: "fake",
        baseUrl: "",
        models: ["other"],
        preserveKey: false,
      }),
    ).rejects.toHaveProperty("code", "MODEL_CATALOG_MANAGED");
    const metadata = JSON.stringify(first);
    expect(metadata).not.toContain("secret_cipher");
    expect(metadata).not.toContain("apiKey");
  } finally {
    await f.cleanup();
  }
});
it("keeps same-named models from different services distinct and pins accepted work through ordinary disable and key-version changes", async () => {
  const f = await imageFixture();
  try {
    const c = new ModelCatalogService(f.creationStore, dir);
    const a = await c.saveService(f.principal, {
        name: "A",
        mode: "fake",
        baseUrl: "",
        revision: 0,
        preserveKey: false,
      }),
      b = await c.saveService(f.principal, {
        name: "B",
        mode: "fake",
        baseUrl: "",
        revision: 0,
        preserveKey: false,
      });
    await c.manual(f.principal, a.id, "shared-image");
    await c.manual(f.principal, b.id, "shared-image");
    const ea = image(a.id),
      eb = image(b.id, "shared-image", false);
    let snapshot = await c.snapshot(f.principal);
    await c.publish(f.principal, {
      revision: snapshot.revision,
      entries: [ea, eb],
    });
    const pools = await c.userPools(f.principal);
    expect(pools.image.map((e) => e.serviceName).sort()).toEqual(["A", "B"]);
    const accepted = await f.creation.submit(
      f.principal,
      f.input({ model: ea.modelId, modelSelectionId: ea.id }),
    );
    expect(accepted.settings).toEqual({
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      referenceIds: [],
      modelSelectionId: ea.id,
    });
    expect(JSON.stringify(accepted)).not.toContain("baseUrl");
    const old = (
      await f.pool.query("SELECT provider_id FROM image_tasks WHERE id=$1", [
        accepted.id,
      ])
    ).rows[0].provider_id;
    await c.saveService(f.principal, {
      id: a.id,
      revision: a.revision,
      name: "A renamed",
      mode: "fake",
      baseUrl: "",
      preserveKey: true,
    });
    const current = (
      await f.pool.query(
        "SELECT image_provider_id FROM model_pool_entries WHERE id=$1",
        [ea.id],
      )
    ).rows[0].image_provider_id;
    expect(current).not.toBe(old);
    expect(
      (
        await f.pool.query("SELECT provider_id FROM image_tasks WHERE id=$1", [
          accepted.id,
        ])
      ).rows[0].provider_id,
    ).toBe(old);
    await c.state(f.principal, a.id, a.revision + 1, false, false);
    await expect(
      f.creation.submit(
        f.principal,
        f.input({ model: ea.modelId, modelSelectionId: ea.id }),
      ),
    ).rejects.toHaveProperty("code", "MODEL_NOT_ALLOWED");
    const w = await f.worker();
    const finished = await f.done(accepted.id);
    expect(finished.state).toBe("succeeded");
    expect(w.fatal()).toBe(false);
    expect((await c.userPools(f.principal)).image.map((e) => e.id)).toEqual([
      eb.id,
    ]);
  } finally {
    await f.cleanup();
  }
});
it("refresh updates only candidates, leaves published pools and failed catalog snapshots intact, and rejects stale directory responses", async () => {
  const f = await imageFixture();
  try {
    let fail = false;
    let release: () => void = () => {};
    let entered: () => void = () => {};
    let pending = false;
    const ready = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const c = new ModelCatalogService(f.creationStore, {
      async list() {
        if (fail) throw Error("directory-unavailable");
        if (pending) {
          entered();
          await gate;
        }
        return ["found-model"];
      },
    });
    const s = await c.saveService(f.principal, {
      name: "Directory",
      mode: "fake",
      baseUrl: "",
      revision: 0,
      preserveKey: false,
    });
    await c.refresh(f.principal, s.id);
    let snapshot = await c.snapshot(f.principal);
    expect(snapshot.models.some((m) => m.modelId === "found-model")).toBe(true);
    expect(snapshot.entries.some((e) => e.modelId === "found-model")).toBe(
      false,
    );
    fail = true;
    await expect(c.refresh(f.principal, s.id)).rejects.toThrow(
      "directory-unavailable",
    );
    expect(await c.snapshot(f.principal)).toEqual(snapshot);
    fail = false;
    pending = true;
    const fetching = c.refresh(f.principal, s.id);
    await ready;
    await c.saveService(f.principal, {
      id: s.id,
      mode: s.mode,
      baseUrl: s.baseUrl,
      name: "Directory changed",
      revision: s.revision,
      preserveKey: true,
    });
    release();
    await expect(fetching).rejects.toHaveProperty(
      "code",
      "MODEL_SERVICE_CONFLICT",
    );
  } finally {
    await f.cleanup();
  }
});
it("enforces per-user pools for both lanes, rolls back invalid publications and revokes outstanding configuration versions", async () => {
  const f = await imageFixture();
  try {
    const c = new ModelCatalogService(f.creationStore, dir);
    const s = await c.saveService(f.principal, {
      name: "ACL",
      mode: "fake",
      baseUrl: "",
      revision: 0,
      preserveKey: false,
    });
    await c.manual(f.principal, s.id, "shared-image");
    await c.manual(f.principal, s.id, "chat");
    const e = image(s.id),
      chat = conversation(s.id);
    let snapshot = await c.snapshot(f.principal);
    await c.publish(f.principal, {
      revision: snapshot.revision,
      entries: [e, chat],
    });
    snapshot = await c.snapshot(f.principal);
    await expect(
      c.publish(f.principal, {
        revision: snapshot.revision,
        entries: [
          {
            ...e,
            modelId: "missing",
            image: { ...e.image!, model: "missing" },
          },
          chat,
        ],
      }),
    ).rejects.toHaveProperty("code", "MODEL_NOT_DISCOVERED");
    expect(await c.snapshot(f.principal)).toEqual(snapshot);
    const policy = await f.creation.getPolicy(f.principal, f.principal.id);
    await f.creation.setPolicy(f.principal, f.principal.id, {
      ...policy,
      allowedModels: [e.id],
    });
    expect((await c.userPools(f.principal)).image).toHaveLength(1);
    await f.creation.setPolicy(f.principal, f.principal.id, {
      ...policy,
      allowedModels: [randomUUID()],
    });
    expect((await c.userPools(f.principal)).image).toHaveLength(0);
    await expect(
      f.creation.submit(
        f.principal,
        f.input({ model: e.modelId, modelSelectionId: e.id }),
      ),
    ).rejects.toHaveProperty("code", "MODEL_NOT_ALLOWED");
    await f.pool.query(
      "INSERT INTO planning_policies(user_id,allowed_models) VALUES($1,$2)",
      [f.principal.id, JSON.stringify([randomUUID()])],
    );
    expect((await c.userPools(f.principal)).conversation).toHaveLength(0);
    const agent = new AgentService(f.creationStore, f.files);
    await expect(
      agent.request(
        f.principal,
        planningRequest.parse({
          projectId: f.project.id,
          requestKey: randomUUID(),
          prompt: "synthetic",
          model: e.modelId,
          modelSelectionId: e.id,
          conversationModelId: chat.id,
          width: 1024,
          height: 1024,
          quality: "medium",
          format: "png",
          referenceIds: [],
        }),
      ),
    ).rejects.toHaveProperty("code", "PLANNING_MODEL_NOT_ALLOWED");
    await c.state(f.principal, s.id, s.revision, false, true);
    const rows = (
      await f.pool.query(
        "SELECT revoked FROM image_provider_versions WHERE service_version_id IN(SELECT id FROM model_service_versions WHERE service_id=$1)",
        [s.id],
      )
    ).rows;
    expect(rows.every((r) => r.revoked)).toBe(true);
    snapshot = await c.snapshot(f.principal);
    await c.publish(f.principal, {
      revision: snapshot.revision,
      entries: snapshot.entries,
    });
    expect((await c.userPools(f.principal)).image).toEqual([]);
    snapshot = await c.snapshot(f.principal);
    await expect(
      c.publish(f.principal, {
        revision: snapshot.revision,
        entries: snapshot.entries.map((entry) =>
          entry.id === e.id
            ? { ...entry, enabled: true, isDefault: true }
            : entry,
        ),
      }),
    ).rejects.toHaveProperty("code", "MODEL_SERVICE_UNAVAILABLE");
    await expect(
      c.publish(f.principal, {
        revision: snapshot.revision,
        entries: snapshot.entries.map((entry) =>
          entry.id === e.id
            ? {
                ...entry,
                image: { ...entry.image!, qualities: ["low", "medium"] },
              }
            : entry,
        ),
      }),
    ).rejects.toHaveProperty("code", "MODEL_SERVICE_UNAVAILABLE");
  } finally {
    await f.cleanup();
  }
});
it("dispatches selected image and conversation services with their pinned credentials and blocks emergency-revoked queued work", async () => {
  const f = await imageFixture();
  try {
    const c = new ModelCatalogService(f.creationStore, dir);
    const a = await c.saveService(f.principal, {
      name: "First",
      mode: "openai",
      baseUrl: "https://first.example/v1",
      apiKey: "synthetic-first",
      revision: 0,
      preserveKey: false,
    });
    const b = await c.saveService(f.principal, {
      name: "Second",
      mode: "openai",
      baseUrl: "https://second.example/v1",
      apiKey: "synthetic-second",
      revision: 0,
      preserveKey: false,
    });
    for (const s of [a, b])
      for (const m of ["shared-image", "chat"])
        await c.manual(f.principal, s.id, m);
    const ea = image(a.id),
      eb = image(b.id, "shared-image", false),
      ca = conversation(a.id),
      cb = conversation(b.id, "chat", false);
    await c.publish(f.principal, {
      revision: (await c.snapshot(f.principal)).revision,
      entries: [ea, eb, ca, cb],
    });
    const task = await f.creation.submit(
      f.principal,
      f.input({ model: eb.modelId, modelSelectionId: eb.id }),
    );
    const agent = new AgentService(f.creationStore, f.files);
    const job = await agent.request(
      f.principal,
      planningRequest.parse(
        (({ count, ...input }) => ({ ...input, conversationModelId: cb.id }))(
          f.input({ model: eb.modelId, modelSelectionId: eb.id }),
        ),
      ),
    );
    await c.saveService(f.principal, {
      id: b.id,
      revision: b.revision,
      name: b.name,
      mode: b.mode,
      baseUrl: b.baseUrl,
      apiKey: "synthetic-rotated",
      preserveKey: false,
    });
    await c.state(f.principal, b.id, b.revision + 1, false, false);
    let imageCalls = 0;
    const activeWorker = await f.worker({
      async generate(config, input) {
        imageCalls++;
        expect(config).toMatchObject({
          baseUrl: b.baseUrl,
          apiKey: "synthetic-second",
        });
        expect(input.model).toBe(eb.modelId);
        return f.png;
      },
    });
    expect((await f.done(task.id)).state).toBe("succeeded");
    expect(imageCalls).toBe(1);
    const { PlanningExecutor } = await import("@tuyile/core");
    let chatCalls = 0;
    await new PlanningExecutor(agent, {
      async complete(config) {
        chatCalls++;
        expect(config).toMatchObject({
          baseUrl: b.baseUrl,
          apiKey: "synthetic-second",
          model: "chat",
        });
        return {
          text: JSON.stringify({ message: "synthetic plan", steps: [] }),
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    }).execute((await agent.claim([]))!, new AbortController().signal);
    expect(chatCalls).toBe(1);
    expect(
      (await agent.jobs(f.principal, f.project.id)).find((j) => j.id === job.id)
        ?.state,
    ).toBe("succeeded");
    await activeWorker.worker.stop();
    const queued = await f.creation.submit(
      f.principal,
      f.input({ model: ea.modelId, modelSelectionId: ea.id }),
    );
    await c.state(f.principal, a.id, a.revision, false, true);
    await f.worker({
      async generate() {
        imageCalls++;
        return f.png;
      },
    });
    expect((await f.done(queued.id)).state).not.toBe("succeeded");
    expect(imageCalls).toBe(1);
  } finally {
    await f.cleanup();
  }
});
it("protects catalog administration with role and CSRF checks and exposes only published user choices", async () => {
  const f = await imageFixture();
  try {
    const c = new ModelCatalogService(f.creationStore, dir);
    await c.bootstrap(f.principal);
    const { createApp } = await import("../../apps/api/src/app.js");
    const origin = "http://127.0.0.1:5180";
    const app = createApp(
      f.service,
      f.store,
      { origin, production: false },
      async () => {},
      () => "catalog-test",
      f.creation,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      c,
    );
    const headers = {
      Cookie: `tuyile_session=${f.login.token}`,
      Origin: origin,
      "Content-Type": "application/json",
    };
    expect((await app.request("/api/models")).status).toBe(401);
    expect(
      (
        await app.request("/api/model-admin/bootstrap", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const member = await f.service.createUser(f.principal, "catalog-member");
    const { testPassword } = await import("../test-database.js");
    await f.service.redeem(member.token, testPassword, "activate");
    const login = await f.service.login("catalog-member", testPassword);
    const memberHeaders = { Cookie: `tuyile_session=${login.token}` };
    expect(
      (
        await app.request("/api/model-admin/catalog", {
          headers: memberHeaders,
        })
      ).status,
    ).toBe(403);
    const result = await app.request("/api/models", { headers: memberHeaders });
    expect(result.status).toBe(200);
    const body = await result.text();
    expect(body).toContain("test-image");
    for (const field of ["baseUrl", "apiKey", "secret_cipher"])
      expect(body).not.toContain(field);
    expect(result.headers.get("cache-control")).toBe("no-store");
  } finally {
    await f.cleanup();
  }
});
