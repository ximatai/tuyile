import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CanvasService } from "@tuyile/core";
import { PgCanvasStore, PgExternalAgentTokens } from "@tuyile/infrastructure";
import { emptyCanvas } from "@tuyile/contracts";
import { createApp } from "../../apps/api/src/app.js";
import { imageFixture } from "../creation-fixture.js";
import { testPassword } from "../test-database.js";

const origin = "https://tuyile.example";
it("limits remote MCP to the authorized project and invalidates rotated, revoked and password-bound tokens", async () => {
  const f = await imageFixture();
  try {
    const canvas = new CanvasService(new PgCanvasStore(f.pool));
    const tokens = new PgExternalAgentTokens(f.pool);
    const app = createApp(
      f.service,
      f.store,
      { origin, production: true },
      async () => {},
      undefined,
      f.creation,
      undefined,
      canvas,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tokens,
    );
    const projectUrl = `${origin}/projects/${f.project.id}`;
    const path = `/api/projects/${f.project.id}/external-agent`;
    const { csrfToken } = await f.service.authenticate(f.login.token);
    const headers = {
      Origin: origin,
      Cookie: `tuyile_session=${f.login.token}`,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    };
    const manage = (action: string, extra: HeadersInit = headers) =>
      app.request(path, {
        method: "POST",
        headers: extra,
        body: JSON.stringify({ action }),
      });
    async function issue() {
      const response = await manage("issue");
      expect(response.status).toBe(201);
      return (await response.json()).token as string;
    }
    function rpc(
      token: string,
      method: string,
      params?: object,
      extra?: HeadersInit,
    ) {
      return app.request("/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...extra,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    }
    const read = (token: string, project = projectUrl) =>
      rpc(token, "tools/call", {
        name: "read_canvas",
        arguments: { projectUrl: project },
      });
    const node = {
      id: randomUUID(),
      kind: "text" as const,
      label: "Title",
      text: "Synthetic note",
      x: 12,
      y: 42,
      width: 120,
      height: 80,
    };
    await canvas.save(f.principal, f.project.id, {
      revision: 0,
      requestKey: randomUUID(),
      placements: [],
      document: { ...emptyCanvas(), nodes: [node] },
    });
    expect(
      (await manage("issue", { ...headers, "X-CSRF-Token": "wrong" })).status,
    ).toBe(403);
    const first = await issue();
    const status = await app.request(path, { headers });
    expect(await status.json()).toMatchObject({
      grant: { scopes: ["canvas:read"] },
    });
    const handshake = await rpc(first, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect((await handshake.json()).result.serverInfo.name).toBe("tuyile");
    const tools = await rpc(first, "tools/list");
    expect(
      (await tools.json()).result.tools.map(
        (tool: { name: string }) => tool.name,
      ),
    ).toEqual(["read_canvas"]);
    expect(
      (await (await read(first)).json()).result.structuredContent,
    ).toMatchObject({
      projectId: f.project.id,
      revision: 1,
      nodes: [node],
      nextOffset: null,
    });
    const other = await f.service.createProject(
      f.principal,
      "Other synthetic project",
    );
    expect(
      (await (await read(first, `${origin}/projects/${other.id}`)).json())
        .result.isError,
    ).toBe(true);
    expect(
      (
        await rpc(first, "tools/list", undefined, {
          Origin: "https://other.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(path, {
          headers: { Authorization: `Bearer ${first}` },
        })
      ).status,
    ).toBe(401);
    const second = await issue();
    expect((await read(first)).status).toBe(401);
    expect((await read(second)).status).toBe(200);
    expect((await manage("revoke")).status).toBe(200);
    expect((await read(second)).status).toBe(401);
    const third = await issue();
    await f.service.changePassword(
      f.principal,
      testPassword,
      `${testPassword}-new`,
    );
    expect((await read(third)).status).toBe(401);
  } finally {
    await f.cleanup();
  }
});
