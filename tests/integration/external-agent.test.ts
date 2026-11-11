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
    async function issue(allowCanvasWrite = false, allowGeneration = false) {
      const response = await app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "issue",
          allowCanvasWrite,
          allowGeneration,
        }),
      });
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
    const noWrite = await rpc(await issue(), "tools/call", {
      name: "edit_canvas",
      arguments: {},
    });
    expect((await noWrite.json()).result.isError).toBe(true);
    const writeToken = await issue(true);
    const node2 = { ...node, id: randomUUID(), label: "Second" };
    const group = randomUUID();
    const batch = (revision: number, operations: object[]) => ({
      name: "edit_canvas",
      arguments: { projectUrl, revision, requestKey: randomUUID(), operations },
    });
    const request = batch(1, [
      { action: "add_text", node: { ...node2, kind: undefined } },
      {
        action: "group_nodes",
        id: group,
        label: "Group",
        nodeIds: [node.id, node2.id],
      },
      { action: "move_node", nodeId: group, x: 10, y: 20 },
    ]);
    expect(
      (await (await rpc(writeToken, "tools/call", request)).json()).result
        .structuredContent.revision,
    ).toBe(2);
    const moved = await canvas.load(f.principal, f.project.id);
    expect(
      moved.document.nodes.filter((n) => n.parentId === group),
    ).toMatchObject([
      { id: node.id, x: 35, y: 60 },
      { id: node2.id, x: 35, y: 60 },
    ]);
    expect(
      (await (await rpc(writeToken, "tools/call", request)).json()).result
        .structuredContent.revision,
    ).toBe(2);
    const stale = batch(1, request.arguments.operations);
    expect(
      (await (await rpc(writeToken, "tools/call", stale)).json()).result
        .isError,
    ).toBe(true);
    const invalid = batch(2, [
      { action: "move_node", nodeId: group, x: 80, y: 90 },
      { action: "move_node", nodeId: randomUUID(), x: 0, y: 0 },
    ]);
    expect(
      (await (await rpc(writeToken, "tools/call", invalid)).json()).result
        .isError,
    ).toBe(true);
    expect(await canvas.load(f.principal, f.project.id)).toEqual(moved);
    const submit = async (token: string, input: object) =>
      (
        await (
          await rpc(token, "tools/call", {
            name: "submit_image_task",
            arguments: { projectUrl, ...input },
          })
        ).json()
      ).result;
    const { projectId: _, ...image } = f.input();
    expect((await submit(writeToken, image)).isError).toBe(true);
    const imageToken = await issue(false, true);
    const unlinked = await f.creation.upload(f.principal, f.png);
    expect(
      await submit(imageToken, { ...image, referenceIds: [unlinked.id] }),
    ).toMatchObject({
      isError: true,
      content: [{ text: "REFERENCE_UNAVAILABLE" }],
    });
    const queued = (await submit(imageToken, image)).structuredContent;
    expect(queued).toMatchObject({
      projectId: f.project.id,
      state: "queued",
      held: 1,
    });
    expect((await submit(imageToken, image)).structuredContent.taskId).toBe(
      queued.taskId,
    );
    const otherTask = await f.creation.submit(
      f.principal,
      f.input({ projectId: other.id }),
    );
    const otherStatus = await rpc(imageToken, "tools/call", {
      name: "get_image_task",
      arguments: { projectUrl, taskId: otherTask.id },
    });
    expect((await otherStatus.json()).result).toMatchObject({
      isError: true,
      content: [{ text: "NOT_FOUND" }],
    });
    const activity = await app.request(path + "/activity", { headers });
    expect(activity.status).toBe(200);
    const { items } = await activity.json();
    expect(
      items.filter(
        (item: { action: string }) => item.action === "canvas_edited",
      ),
    ).toMatchObject([{ actor: "admin", revision: 2, taskId: null }]);
    expect(
      items.filter(
        (item: { action: string }) => item.action === "image_submitted",
      ),
    ).toMatchObject([{ actor: "admin", taskId: queued.taskId }]);
    expect(
      items.some((item: { action: string }) => item.action === "grant_revoked"),
    ).toBe(true);
    expect(JSON.stringify(items)).not.toContain(imageToken);
    expect(
      (
        await app.request(path + "/activity", {
          headers: { Authorization: `Bearer ${imageToken}` },
        })
      ).status,
    ).toBe(401);
    const otherActivity = await app.request(
      `/api/projects/${other.id}/external-agent/activity`,
      { headers },
    );
    expect(await otherActivity.json()).toEqual({ items: [], hasMore: false });
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
