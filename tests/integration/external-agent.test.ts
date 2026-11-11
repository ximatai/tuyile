import { expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { CanvasService } from "@tuyile/core";
import {
  PgCanvasStore,
  PgExternalAgentTokens,
  security,
} from "@tuyile/infrastructure";
import { emptyCanvas } from "@tuyile/contracts";
import { createApp } from "../../apps/api/src/app.js";
import { imageFixture } from "../creation-fixture.js";
import { finishTemporaryPassword, testPassword } from "../test-database.js";

const origin = "https://tuyile.example";
it("limits remote MCP to the authorized project and invalidates rotated, revoked and password-bound tokens", async () => {
  const f = await imageFixture();
  try {
    const canvas = new CanvasService(new PgCanvasStore(f.pool));
    const tokens = new PgExternalAgentTokens(
      f.pool,
      process.env.APP_MASTER_KEY!,
    );
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
      // Simulate a project grant already present when the instance upgraded.
      const token = `tuyile_${randomBytes(32).toString("base64url")}`;
      const scopes = ["canvas:read"];
      if (allowCanvasWrite) scopes.push("canvas:write");
      if (allowGeneration) scopes.push("images:generate");
      await f.pool.query(
        `INSERT INTO external_agent_tokens(project_id,workspace_id,user_id,execution_version,token_hash,expires_at,scopes)
         VALUES ($1,$2,$3,$4,$5,now()+interval '7 days',$6)
         ON CONFLICT(project_id) DO UPDATE SET token_hash=excluded.token_hash,scopes=excluded.scopes,verified_at=NULL`,
        [
          f.project.id,
          f.principal.workspaceId,
          f.principal.id,
          f.principal.executionVersion,
          security.digest(token),
          scopes,
        ],
      );
      return token;
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
    expect((await manage("issue")).status).toBe(409);
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
    ).toEqual(["read_canvas", "read_image", "get_image_download_link"]);
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
    expect(await otherActivity.json()).toEqual({
      items: [],
      hasMore: false,
      undoRevision: null,
    });
    const undoPath = path + "/undo";
    const undo = (
      revision: number,
      requestKey = randomUUID(),
      requestHeaders = headers,
    ) =>
      app.request(undoPath, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ revision, requestKey }),
      });
    const undoKey = randomUUID();
    expect((await undo(1)).status).toBe(409);
    expect(
      (await undo(2, undoKey, { ...headers, "X-CSRF-Token": "wrong" })).status,
    ).toBe(403);
    const reverted = await undo(2, undoKey);
    expect(reverted.status).toBe(200);
    expect(await reverted.json()).toMatchObject({
      revision: 3,
      document: { nodes: [node] },
    });
    expect((await (await undo(2, undoKey)).json()).revision).toBe(3);
    expect((await undo(3)).status).toBe(409);
    const postUndo = await (
      await app.request(path + "/activity", { headers })
    ).json();
    expect(postUndo.undoRevision).toBeNull();
    expect(
      postUndo.items.filter(
        (item: { action: string }) => item.action === "canvas_undone",
      ),
    ).toMatchObject([{ revision: 3 }]);
    const anotherWriteToken = await issue(true);
    expect(
      (
        await (
          await rpc(
            anotherWriteToken,
            "tools/call",
            batch(3, [{ action: "move_node", nodeId: node.id, x: 90, y: 90 }]),
          )
        ).json()
      ).result.structuredContent.revision,
    ).toBe(4);
    const later = await canvas.save(f.principal, f.project.id, {
      revision: 4,
      requestKey: randomUUID(),
      placements: [],
      document: {
        ...emptyCanvas(),
        nodes: [{ ...node, label: "Saved afterwards" }],
      },
    });
    expect((await undo(4)).status).toBe(409);
    expect(await canvas.load(f.principal, f.project.id)).toEqual(later);
    const third = await issue();
    const accountPath = "/api/account/external-agent";
    const accountStatus = async () =>
      (await app.request(accountPath, { headers })).json();
    const accountChange = async (
      body: object,
      expectedGrantId?: string | null,
    ) => {
      if (expectedGrantId === undefined)
        expectedGrantId = (await accountStatus()).grant?.id ?? null;
      return app.request(accountPath, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, expectedGrantId }),
      });
    };
    expect(await accountStatus()).toEqual({ grant: null, savedScopes: [] });
    expect((await app.request(accountPath)).status).toBe(401);
    const issued = await accountChange({
      action: "issue",
      allowCanvasWrite: true,
      allowGeneration: true,
    });
    expect(issued.status).toBe(201);
    const { token: accountToken, grant: issuedGrant } = await issued.json();
    expect(await accountStatus()).toMatchObject({
      grant: { verifiedAt: null },
    });
    const check = await rpc(accountToken, "tools/call", {
      name: "check_connection",
      arguments: {},
    });
    expect((await check.json()).result.structuredContent).toEqual({
      connected: true,
    });
    expect(await accountStatus()).toMatchObject({
      grant: { verifiedAt: expect.any(String) },
    });
    expect(JSON.stringify(await accountStatus())).not.toContain(accountToken);

    const otherUrl = `${origin}/projects/${other.id}`;
    for (const [url, projectId] of [
      [projectUrl, f.project.id],
      [otherUrl, other.id],
    ])
      expect(
        (await (await read(accountToken, url)).json()).result.structuredContent
          .projectId,
      ).toBe(projectId);
    expect((await (await read(third, otherUrl)).json()).result.isError).toBe(
      true,
    );
    const member = await f.service.createUser(f.principal, "mcp_other_account");
    await finishTemporaryPassword(f.service, member);
    const memberSession = await f.service.login(
      member.user.username,
      testPassword,
    );
    const { user: memberPrincipal } = await f.service.authenticate(
      memberSession.token,
    );
    const foreign = await f.service.createProject(
      memberPrincipal,
      "Private project",
    );
    const foreignUrl = `${origin}/projects/${foreign.id}`;
    expect(
      (await (await read(accountToken, foreignUrl)).json()).result,
    ).toMatchObject({
      isError: true,
      content: [{ text: "NOT_FOUND" }],
    });
    const accountEdit = batch(0, [
      { action: "add_text", node: { ...node, kind: undefined } },
    ]);
    accountEdit.arguments.projectUrl = otherUrl;
    expect(
      (await (await rpc(accountToken, "tools/call", accountEdit)).json()).result
        .structuredContent,
    ).toMatchObject({ projectId: other.id, revision: 1 });
    expect(
      (
        await submit(accountToken, {
          ...image,
          projectUrl: otherUrl,
          requestKey: randomUUID(),
        })
      ).structuredContent,
    ).toMatchObject({ projectId: other.id, state: "queued" });

    const imageTool = async (
      name: string,
      assetId: string,
      url = otherUrl,
      token = accountToken,
    ) =>
      (
        await (
          await rpc(token, "tools/call", {
            name,
            arguments: { projectUrl: url, assetId },
          })
        ).json()
      ).result;
    expect(await imageTool("read_image", unlinked.id)).toMatchObject({
      isError: true,
    });
    expect(
      await imageTool("get_image_download_link", unlinked.id),
    ).toMatchObject({ isError: true });
    const imageNode = {
      kind: "image" as const,
      id: randomUUID(),
      assetId: unlinked.id,
      label: "Linked upload",
      x: 0,
      y: 0,
      width: 128,
      height: 128,
    };
    await canvas.save(f.principal, other.id, {
      revision: 1,
      requestKey: randomUUID(),
      placements: [],
      document: { ...emptyCanvas(), nodes: [imageNode] },
    });
    expect(
      await imageTool("read_image", unlinked.id, projectUrl),
    ).toMatchObject({ isError: true });
    expect(
      await imageTool("read_image", unlinked.id, otherUrl, third),
    ).toMatchObject({ isError: true });
    const preview = await imageTool("read_image", unlinked.id);
    expect(preview).toMatchObject({
      content: [{ type: "image", mimeType: "image/webp" }],
    });
    expect(preview).not.toHaveProperty("structuredContent");
    expect(
      Buffer.from(preview.content[0].data, "base64").subarray(8, 12).toString(),
    ).toBe("WEBP");
    const { url: downloadUrl, expiresAt } = (
      await imageTool("get_image_download_link", unlinked.id)
    ).structuredContent;
    const download = await app.request(downloadUrl);
    expect(download.status).toBe(200);
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");
    expect(download.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(f.png);
    const tampered = new URL(downloadUrl);
    tampered.pathname = tampered.pathname.replace(unlinked.id, randomUUID());
    expect((await app.request(tampered)).status).toBe(404);
    const shorterExpiry = new URL(downloadUrl);
    shorterExpiry.searchParams.set(
      "expires",
      String(Date.parse(expiresAt) / 1000 - 10),
    );
    expect((await app.request(shorterExpiry)).status).toBe(404);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiresAt));
    try {
      expect((await app.request(downloadUrl)).status).toBe(404);
    } finally {
      clock.mockRestore();
    }

    const { token: replacement } = await (
      await accountChange({ action: "issue", allowCanvasWrite: true })
    ).json();
    expect((await read(accountToken)).status).toBe(401);
    expect((await app.request(downloadUrl)).status).toBe(404);
    expect((await read(third)).status).toBe(200);
    expect(
      (await accountChange({ action: "revoke" }, issuedGrant.id)).status,
    ).toBe(409);
    expect(
      (await accountChange({ action: "issue" }, issuedGrant.id)).status,
    ).toBe(409);
    expect((await read(replacement)).status).toBe(200);
    expect(await (await accountChange({ action: "revoke" })).json()).toEqual({
      grant: null,
      savedScopes: ["canvas:read", "canvas:write"],
    });
    expect((await read(replacement)).status).toBe(401);
    expect((await read(third)).status).toBe(200);
    const { token: passwordBoundAccount } = await (
      await accountChange({ action: "issue" })
    ).json();
    await f.service.changePassword(
      f.principal,
      testPassword,
      `${testPassword}-new`,
    );
    expect((await read(third)).status).toBe(401);
    expect((await read(passwordBoundAccount)).status).toBe(401);
  } finally {
    await f.cleanup();
  }
});
