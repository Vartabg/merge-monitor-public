import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApi } from "../server/api.mjs";
import { createBoardStore } from "../server/board.mjs";
import { boardClient, runBoard } from "../scripts/board-client.mjs";

let folder, server, origin, board, mcp;
const sourceId = "01a154c2-5cba-7020-8991-079c4ba3078f";
const member = {
  project: "studio",
  agent: "worker",
  task: "Update /work landing page Excel $100 menu",
  scope: "Professional service offers",
  state: "working",
};
function note(overrides = {}) {
  return {
    id: "offer",
    threadId: sourceId,
    kind: "keep",
    text: "Simple landing page; Excel document handler. Third item and price basis unresolved.",
    returnPoint: "Recover the missing terms.",
    decision: {
      projectPath: folder,
      topic: "/work $100 menu",
      status: "unresolved",
      quote:
        "One offering was a simple landing page; another an Excel document handler.",
      sourceTurnId: "",
      recordedAt: "2026-10-19T12:00:00.000Z",
    },
    ...overrides,
  };
}
async function save(notes = [note()]) {
  await writeFile(
    join(folder, "settings.json"),
    JSON.stringify({ revision: 1, notes }),
  );
}
async function call(name, args) {
  const result = await mcp.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0].text);
}
beforeEach(async () => {
  folder = await realpath(
    await mkdtemp(join(tmpdir(), "decision-recall-api-")),
  );
  vi.stubEnv("MERGE_MONITOR_COMMON_GROUND_STATE_DIR", folder);
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  await save();
  mcp = new Client({ name: "decision-fixture", version: "1" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/board-mcp.mjs")],
      env: { ...process.env, MERGE_MONITOR_ORIGIN: origin },
    }),
  );
});
afterEach(async () => {
  await mcp?.close();
  await new Promise((done) => server.close(done));
  await rm(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("recalls a source-linked agreement with its unknowns on real MCP check-in despite newer board noise", async () => {
  const client = boardClient(origin);
  await client("check-in", member);
  const post = (text) =>
    client("post", {
      project: "studio",
      agent: "worker",
      kind: "decision",
      text,
    });
  const original = await post(
    "The /work menu includes an Excel handler; third item is still unresolved.",
  );
  const oldId = original.room.messages.at(-1).id;
  for (let index = 0; index < 8; index++)
    await post(`Terrain audio verification iteration ${index}`);
  const result = await call("team_check_in", member);
  expect(result.brief.messages.map((m) => m.id)).toContain(oldId);
  expect(result.brief.savedDecisions).toHaveLength(1);
  expect(result.brief.savedDecisions[0]).toMatchObject({
    status: "unresolved",
    sourceTurnId: "",
    chatUrl: `codex://threads/${sourceId}`,
  });
  expect(result.brief.savedDecisions[0].text).toContain(
    "price basis unresolved",
  );
  expect(result.brief.decisionRecall.status).toBe("available");
  expect(board.view("studio").room.members[0].lastReadSequence).toBe(0);
});

it("searches both saved and board decisions through MCP and CLI without marking a read or inventing matches", async () => {
  await call("team_check_in", member);
  await boardClient(origin)("post", {
    project: "studio",
    agent: "worker",
    kind: "decision",
    text: "Keep the Excel handler in the menu.",
  });
  const found = await call("team_search_decisions", {
    project: "studio",
    query: "Excel",
  });
  expect(found.savedDecisions).toHaveLength(1);
  expect(found.boardDecisions).toHaveLength(1);
  const cli = await runBoard([
    "decisions",
    "--project",
    "studio",
    "--query",
    "Excel",
    "--origin",
    origin,
  ]);
  expect(cli.savedDecisions).toEqual(found.savedDecisions);
  const missing = await call("team_search_decisions", {
    project: "studio",
    query: "quasar",
  });
  expect(missing.savedDecisions).toEqual([]);
  expect(missing.boardDecisions).toEqual([]);
  expect(missing.decisionRecall.status).toBe("available");
  expect(board.view("studio").room.members[0].lastReadSequence).toBe(0);
  await expect(
    runBoard([
      "context",
      "--project",
      "studio",
      "--agent",
      "worker",
      "--query",
      "Excel",
      "--origin",
      origin,
    ]),
  ).rejects.toThrow("only used with decisions");
});

it("keeps MCP and terminal check-ins successful on unavailable source and refreshes saved status without caching", async () => {
  await writeFile(join(folder, "settings.json"), "invalid");
  expect(
    (await call("team_check_in", member)).brief.decisionRecall.status,
  ).toBe("unavailable");
  const input = join(folder, "check-in.json");
  await writeFile(input, JSON.stringify(member));
  const terminal = await runBoard([
    "check-in",
    "--input",
    input,
    "--origin",
    origin,
  ]);
  expect(terminal.room.members[0].agent).toBe("worker");
  expect(terminal.brief.decisionRecall.status).toBe("unavailable");
  await save();
  expect(
    (await call("team_get_context", { project: "studio", agent: "worker" }))
      .savedDecisions,
  ).toHaveLength(1);
  const superseded = note();
  superseded.decision.status = "superseded";
  await save([superseded]);
  expect(
    (await call("team_get_context", { project: "studio", agent: "worker" }))
      .savedDecisions,
  ).toEqual([]);
});

it("caps check-in excerpts explicitly while an intentional search returns full saved words", async () => {
  const long = note({ text: `Excel ${"word ".repeat(350)}` });
  await save([long]);
  const brief = (await call("team_check_in", member)).brief;
  expect(brief.savedDecisions[0].text).toHaveLength(600);
  expect(brief.savedDecisions[0].truncated).toBe(true);
  const full = await call("team_search_decisions", {
    project: "studio",
    query: "Excel",
  });
  expect(full.savedDecisions[0].text).toBe(long.text);
});
