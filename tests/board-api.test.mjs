import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApi } from "../server/api.mjs";
import { createBoardStore } from "../server/board.mjs";
import { boardClient, runBoard } from "../scripts/board-client.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
let folder, server, origin, board, token;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "board-api-"));
  board = await createBoardStore(join(folder, "board.json"));
  const monitor = {
    config: {
      defaultRepo: "studio",
      repos: [{ id: "studio", label: "Studio", path: folder }],
    },
    repo(id) {
      if (id !== "studio")
        throw Object.assign(new Error("Unknown project"), { statusCode: 404 });
    },
  };
  server = createServer(createApi(monitor, {}, undefined, board));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(`${origin}/api/session`)).json()).token;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(folder, { recursive: true, force: true });
});
const checkin = (agent) => ({
  project: "studio",
  agent,
  task: "Coordinate a real task",
  scope: "This project",
  state: "working",
});
function post(path, value, headers = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Merge-Monitor-Token": token,
      ...headers,
    },
    body: JSON.stringify(value),
  });
}
it("rejects hostile origins, missing session tokens, unknown projects and oversized requests", async () => {
  expect(
    (
      await fetch(`${origin}/api/board?project=studio`, {
        headers: { Origin: "https://evil.invalid" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await post("/api/board/check-in", checkin("writer"), {
        "X-Merge-Monitor-Token": "",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await post("/api/board/check-in", {
        ...checkin("writer"),
        project: "other",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await post("/api/board/check-in", {
        ...checkin("writer"),
        task: "x".repeat(17000),
      })
    ).status,
  ).toBe(413);
  expect((await fetch(`${origin}/api/board/ack`)).status).toBe(405);
  expect((await post("/api/board/unknown", {})).status).toBe(404);
});
it("delivers addressed messages through the CLI and keeps pending work after reading", async () => {
  const client = boardClient(origin);
  await client("check-in", checkin("writer"));
  await client("check-in", checkin("reviewer"));
  await client("post", {
    project: "studio",
    agent: "writer",
    to: "reviewer",
    kind: "handoff",
    text: "Please verify the new board API.",
  });
  const result = await runBoard([
    "wait",
    "--origin",
    origin,
    "--project",
    "studio",
    "--agent",
    "reviewer",
    "--seconds",
    "1",
  ]);
  expect(result.available).toBe(true);
  expect(result.pendingIds).toHaveLength(1);
  const brief = await runBoard([
    "brief",
    "--origin",
    origin,
    "--project",
    "studio",
    "--agent",
    "reviewer",
  ]);
  expect(brief.unreadIds).toEqual([]);
  expect(brief.pendingIds).toHaveLength(1);
});
it("fails closed on nonlocal origins, invalid report data and redirected responses", async () => {
  expect(() => boardClient("https://example.com")).toThrow("local");
  expect(() => boardClient("http://user:pass@127.0.0.1:5173")).toThrow("local");
  const malformed = boardClient(
    origin,
    async () => new Response(JSON.stringify({ room: {} })),
  );
  await expect(malformed("view", { project: "studio" })).rejects.toThrow(
    "invalid",
  );
  expect(() => boardClient(`${origin}/wrong`)).toThrow("local");
});
it("exposes working MCP tools to separate agent connections over stdio", async () => {
  const clients = [];
  try {
    for (const agent of ["writer", "reviewer"]) {
      const client = new Client({ name: agent, version: "1.0" });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [resolve("scripts/board-mcp.mjs")],
          env: { ...process.env, MERGE_MONITOR_ORIGIN: origin },
        }),
      );
      clients.push(client);
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(
        "team_post_message",
      );
      const result = await client.callTool({
        name: "team_check_in",
        arguments: checkin(agent),
      });
      expect(result.isError).not.toBe(true);
    }
    const result = await clients[0].callTool({
      name: "team_post_message",
      arguments: {
        project: "studio",
        agent: "writer",
        to: "reviewer",
        kind: "handoff",
        text: "Verify the board.",
        replyTo: "",
        requestId: crypto.randomUUID(),
      },
    });
    expect(result.isError).not.toBe(true);
    const read = await clients[1].callTool({
      name: "team_read_board",
      arguments: { project: "studio", agent: "reviewer" },
    });
    const report = JSON.parse(read.content[0].text);
    expect(report.pendingIds).toHaveLength(1);
    const context = await clients[1].callTool({
      name: "team_get_context",
      arguments: { project: "studio", agent: "reviewer" },
    });
    expect(context.isError).not.toBe(true);
    const brief = JSON.parse(context.content[0].text);
    expect(brief.counts.openRequestsForYou).toBe(1);
    const detail = await clients[1].callTool({
      name: "team_get_message",
      arguments: { project: "studio", messageId: report.pendingIds[0] },
    });
    expect(JSON.parse(detail.content[0].text).message.text).toBe(
      "Verify the board.",
    );

    const ack = await clients[1].callTool({
      name: "team_acknowledge",
      arguments: {
        project: "studio",
        agent: "reviewer",
        messageId: report.pendingIds[0],
      },
    });
    expect(
      JSON.parse(ack.content[0].text).room.messages[0].acknowledgedAt,
    ).not.toBe("");
  } finally {
    await Promise.all(clients.map((c) => c.close()));
  }
});
