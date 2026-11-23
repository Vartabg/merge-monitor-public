import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApi } from "../server/api.mjs";
import { createAssignmentStore } from "../server/assignments.mjs";
import { createBoardStore } from "../server/board.mjs";
import { createExecutionStore } from "../server/executions.mjs";
import { inspectRepository } from "../server/inspection.mjs";
import { createStateStore } from "../server/state.mjs";
import { saveTaskContext } from "../server/task-context.mjs";
import { createTeamWorkflow } from "../server/team-workflow.mjs";
import { createWorker } from "../server/worker.mjs";
import { boardClient, runBoard } from "../scripts/board-client.mjs";
import {
  defaultNotify,
  escalate,
  openChat,
  pendingClaims,
  pruneWakes,
  runDispatch,
  validateConfig,
} from "../scripts/dispatch.mjs";
import {
  findSupersededLaunchAgents,
  reinstallLaunchAgent,
  syncDispatchLaunchAgent,
} from "../scripts/install-service.mjs";
import {
  DEFAULT_SERVICE_LABEL,
  renderDispatchPlist,
  renderServerPlist,
  serviceLabelSetting,
  staleHoursSetting,
} from "../scripts/service-env.mjs";
import { repository } from "./fixtures.mjs";

const execFileAsync = promisify(execFile);
const cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function makeTempDir(prefix = "mm-hardening-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("Track 1: board capacity pruning, human slot reservation, and wake/context bounds", () => {
  it("reserves slot 100 for human, rejects 101st member cleanly, and prunes only eligible check-ins while preserving messages and assignments", async () => {
    const dir = await makeTempDir("mm-board-prune-");
    let nowIso = "2026-10-01T00:00:00.000Z";
    const boardPath = join(dir, "board.json");
    const board = await createBoardStore(boardPath, {
      now: () => nowIso,
      staleAfterHours: 24,
    });
    const assignments = await createAssignmentStore(join(dir, "assignments.json"));
    const monitor = {
      config: { defaultRepo: "studio", repos: [{ id: "studio", label: "Studio", path: dir }] },
      repo(id) {
        if (id !== "studio") throw Object.assign(new Error("Unknown project"), { statusCode: 404 });
      },
    };
    const server = createServer(createApi(monitor, {}, assignments, board));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { token } = await (await fetch(`${origin}/api/session`)).json();
    const post = (path, payload) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", "X-Merge-Monitor-Token": token },
        body: JSON.stringify(payload),
      });

    // Empty room: non-human cannot prune, human does not allocate empty room
    expect((await post("/api/board/prune-members", { project: "studio", agent: "ghost" })).status).toBe(409);
    const emptyPrune = await post("/api/board/prune-members", { project: "studio", agent: "human" });
    expect(emptyPrune.status).toBe(200);
    expect((await emptyPrune.json()).room.members).toEqual([]);

    // Fill 99 non-human agents; 100th non-human fails with 409 because slot 100 is reserved for human
    for (let i = 1; i <= 99; i++) {
      await board.command("check-in", {
        project: "studio",
        agent: `agent-${i}`,
        task: `Task ${i}`,
        scope: "Scope",
        state: i <= 95 ? "done" : "working",
      });
    }
    await expect(
      board.command("check-in", {
        project: "studio",
        agent: "agent-100",
        task: "Overflow",
        scope: "Scope",
        state: "working",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Protect agent-1 (open addressed message), agent-2 (active assignment owner), agent-3 (active assignment reviewer)
    await board.command("post", {
      project: "studio",
      agent: "agent-99",
      to: "agent-1",
      kind: "question",
      text: "Need answer before closing.",
      replyTo: "",
      requestId: randomUUID(),
    });
    await assignments.create({
      title: "Protected work",
      project: "studio",
      purpose: "Keep active participants",
      owner: "agent-2",
      model: "synthetic",
      reviewer: "agent-3",
      scope: "Only src/",
      acceptance: "Passes",
      budget: "Local",
    });

    // Advance time past 24h so agent-96..agent-99 (working) become stale
    nowIso = "2026-10-03T00:00:00.000Z";

    // Human has NOT checked in yet, yet can prune directly via API (slot 100 also still available!)
    const pruneDone = await post("/api/board/prune-members", {
      project: "studio",
      agent: "human",
    });
    expect(pruneDone.status).toBe(200);
    const afterDone = await pruneDone.json();
    const namesAfterDone = afterDone.room.members.map((m) => m.agent);
    expect(namesAfterDone).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "agent-96",
      "agent-97",
      "agent-98",
      "agent-99",
    ]);
    expect(afterDone.room.messages).toHaveLength(1);

    // Prune again with includeStale: true clears stale working agents 96..99 while keeping 1..3
    const pruneStale = await post("/api/board/prune-members", {
      project: "studio",
      agent: "human",
      includeStale: true,
    });
    expect(pruneStale.status).toBe(200);
    expect((await pruneStale.json()).room.members.map((m) => m.agent)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
    ]);

    // Pre-existing 100/100 room without human rejects human check-in with 409 (not 400 BoardState)
    const fullPath = join(dir, "full.json");
    const fullMembers = Array.from({ length: 100 }, (_, i) => ({
      agent: `pre-${i + 1}`,
      task: "Pre-existing",
      scope: "",
      state: "done",
      checkedInAt: "2026-10-01T00:00:00.000Z",
      lastReadAt: "",
      lastReadSequence: 0,
    }));
    await writeFile(
      fullPath,
      JSON.stringify({
        version: 1,
        rooms: [{ project: "studio", goal: "", goalBy: "", goalAt: "", revision: 0, members: fullMembers, messages: [] }],
      }),
      { mode: 0o600 },
    );
    const fullStore = await createBoardStore(fullPath);
    await expect(
      fullStore.command("check-in", {
        project: "studio",
        agent: "human",
        task: "Owner check-in",
        scope: "",
        state: "idle",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    // Human can still recover the 100/100 room via prune-members directly!
    const recovered = await fullStore.command("prune-members", { project: "studio", agent: "human" });
    expect(recovered.room.members).toEqual([]);
  });

  it("returns compact receipts for CLI check-in/prune-members and exposes team_prune_members over MCP", async () => {
    const dir = await makeTempDir("mm-cli-mcp-");
    const board = await createBoardStore(join(dir, "board.json"));
    const monitor = {
      config: { defaultRepo: "studio", repos: [{ id: "studio", label: "Studio", path: dir }] },
      repo(id) {
        if (id !== "studio") throw Object.assign(new Error("Unknown project"), { statusCode: 404 });
      },
    };
    const server = createServer(createApi(monitor, {}, undefined, board));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const cliCheckIn = await runBoard([
      "check-in",
      "--origin",
      origin,
      "--project",
      "studio",
      "--agent",
      "done-worker",
      "--input",
      await (async () => {
        const p = join(dir, "in.json");
        await writeFile(p, JSON.stringify({ task: "Finished task", scope: "All", state: "done" }));
        return p;
      })(),
    ]);
    expect(cliCheckIn.action).toBe("check-in");
    expect(cliCheckIn.brief.project).toBe("studio");
    expect(cliCheckIn.room.members).toHaveLength(1);

    await expect(
      runBoard(["view", "--origin", origin, "--project", "studio", "--include-stale"]),
    ).rejects.toThrow(/--include-stale is only used with prune-members/);
    await expect(
      runBoard([
        "prune-members",
        "--origin",
        origin,
        "--project",
        "studio",
        "--agent",
        "human",
        "--include-stale",
        "--include-stale",
      ]),
    ).rejects.toThrow(/once/);

    const cliPrune = await runBoard([
      "prune-members",
      "--origin",
      origin,
      "--project",
      "studio",
      "--agent",
      "human",
    ]);
    expect(cliPrune).toMatchObject({ action: "prune-members", remainingMembers: 0 });

    // Re-add one done member and prune via MCP team_prune_members
    const bc = boardClient(origin);
    await bc("check-in", { project: "studio", agent: "mcp-done", task: "Done", scope: "", state: "done" });
    await bc("check-in", { project: "studio", agent: "mcp-caller", task: "Active", scope: "", state: "working" });

    const client = new Client({ name: "prune-tester", version: "1.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("scripts/board-mcp.mjs")],
        env: { ...process.env, MERGE_MONITOR_ORIGIN: origin },
      }),
    );
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toContain("team_prune_members");
      const res = await client.callTool({
        name: "team_prune_members",
        arguments: { project: "studio", agent: "mcp-caller" },
      });
      expect(res.isError).not.toBe(true);
      const receipt = JSON.parse(res.content[0].text);
      expect(receipt).toMatchObject({ action: "prune-members", remainingMembers: 1 });
    } finally {
      await client.close();
    }
  });

  it("caps taskContexts at 500 entries and prunes old claimed wakes without touching unclaimed wakes", async () => {
    const dir = await makeTempDir("mm-caps-");
    const store = await createStateStore(join(dir, "state.json"));
    const seeded = Array.from({ length: 505 }, (_, i) => ({
      repoId: "demo",
      path: `/wt/${i}`,
      branch: `b-${i}`,
      title: `Title ${i}`,
      purpose: "",
      owner: "",
      updatedAt: "2026-10-01T00:00:00.000Z",
    }));
    await store.update((s) => ({ ...s, taskContexts: seeded }));
    const monitor = {
      store,
      refresh: async () => ({
        worktrees: [{ primary: false, path: "/wt/new", branch: "b-new" }],
      }),
    };
    await saveTaskContext(monitor, {
      repoId: "demo",
      path: "/wt/new",
      branch: "b-new",
      title: "Latest",
      purpose: "",
      owner: "",
    });
    expect(store.get().taskContexts).toHaveLength(500);
    expect(store.get().taskContexts[0].branch).toBe("b-new");

    const now = Date.parse("2026-11-22T00:00:00Z");
    const wakes = {
      oldClaimed: { at: "2026-09-01T00:00:00Z", claimed: true, escalated: false },
      oldUnclaimed: { at: "2026-09-01T00:00:00Z", claimed: false, escalated: true },
      recentClaimed1: { at: "2026-11-20T00:00:00Z", claimed: true, escalated: false },
      recentClaimed2: { at: "2026-11-21T00:00:00Z", claimed: true, escalated: false },
    };
    const removed = pruneWakes(wakes, now, { maxAgeMs: 30 * 86400_000, maxEntries: 2 });
    expect(removed).toBe(2);
    expect(Object.keys(wakes).sort()).toEqual(["oldUnclaimed", "recentClaimed2"]);
  });
});

describe("Track 2: server API, board idempotency, detached HEAD, workflow, worker, executions, and dispatcher", () => {
  it("decodes split multi-byte UTF-8 chunks accurately and normalizes Content-Type", async () => {
    const dir = await makeTempDir("mm-utf8-");
    const board = await createBoardStore(join(dir, "board.json"));
    const monitor = {
      config: { defaultRepo: "studio", repos: [{ id: "studio", label: "Studio", path: dir }] },
      repo(id) {
        if (id !== "studio") throw Object.assign(new Error("Unknown"), { statusCode: 404 });
      },
    };
    const server = createServer(createApi(monitor, {}, undefined, board));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const port = server.address().port;
    const { token } = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();

    const payload = Buffer.from(
      JSON.stringify({
        project: "studio",
        agent: "utf8-agent",
        task: "Check 日本語 — ✅ split bytes",
        scope: "Unicode boundary",
        state: "working",
      }),
      "utf8",
    );
    // Split directly inside a multi-byte UTF-8 character
    const splitAt = payload.indexOf(Buffer.from("日", "utf8")) + 1;
    const response = await new Promise((resolvePromise, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/api/board/check-in",
          method: "POST",
          headers: {
            Host: `127.0.0.1:${port}`,
            Origin: `http://127.0.0.1:${port}`,
            "Content-Type": "Application/JSON ; charset=utf-8",
            "X-Merge-Monitor-Token": token,
            "Content-Length": payload.length,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolvePromise({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            }),
          );
        },
      );
      req.on("error", reject);
      req.write(payload.subarray(0, splitAt));
      setTimeout(() => {
        req.write(payload.subarray(splitAt));
        req.end();
      }, 10);
    });
    expect(response.status).toBe(200);
    expect(response.body.room.members[0].task).toBe("Check 日本語 — ✅ split bytes");
  });

  it("validates board post idempotency canonically across key order, omitted finding/attention, and legacy pre-attention handoffs", async () => {
    const dir = await makeTempDir("mm-idemp-");
    const boardPath = join(dir, "board.json");
    const board = await createBoardStore(boardPath);
    await board.command("check-in", { project: "studio", agent: "writer", task: "Write", scope: "", state: "working" });
    await board.command("check-in", { project: "studio", agent: "reviewer", task: "Review", scope: "", state: "working" });

    const reqId = randomUUID();
    const findingA = {
      claim: "A bug",
      evidence: "file.mjs:1",
      expected: "pass",
      actual: "fail",
      severity: "blocking",
      scope: "server/",
      doneCheck: "vitest",
    };
    const findingReordered = {
      doneCheck: "vitest",
      scope: "server/",
      severity: "blocking",
      actual: "fail",
      expected: "pass",
      evidence: "file.mjs:1",
      claim: "A bug",
    };
    const basePost = {
      project: "studio",
      agent: "writer",
      to: "reviewer",
      kind: "handoff",
      attention: "action",
      text: "Check finding",
      replyTo: "",
      requestId: reqId,
      finding: findingA,
    };
    await board.command("post", basePost);
    // Reordered finding keys -> idempotent
    const retried = await board.command("post", { ...basePost, finding: findingReordered });
    expect(retried.room.messages).toHaveLength(1);
    // Omitted finding -> 409
    const withoutFinding = { ...basePost };
    delete withoutFinding.finding;
    await expect(board.command("post", withoutFinding)).rejects.toMatchObject({ statusCode: 409 });
    // Omitted attention (defaults to fyi vs stored action) -> 409
    const withoutAttention = { ...basePost };
    delete withoutAttention.attention;
    await expect(board.command("post", withoutAttention)).rejects.toMatchObject({ statusCode: 409 });

    // Legacy pre-attention handoff rejects retry specifying explicit attention: "fyi"
    const legacyId = randomUUID();
    await board.command("post", {
      project: "studio",
      agent: "writer",
      to: "reviewer",
      kind: "handoff",
      text: "Legacy handoff",
      replyTo: "",
      requestId: legacyId,
    });
    const raw = JSON.parse(await readFile(boardPath, "utf8"));
    delete raw.rooms[0].messages[1].attention;
    await writeFile(boardPath, JSON.stringify(raw), { mode: 0o600 });
    const reopened = await createBoardStore(boardPath);
    await expect(
      reopened.command("post", {
        project: "studio",
        agent: "writer",
        to: "reviewer",
        kind: "handoff",
        attention: "fyi",
        text: "Legacy handoff",
        replyTo: "",
        requestId: legacyId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("handles detached HEAD worktrees without failing inspection or poisoning status.incomplete", async () => {
    const f = await repository();
    cleanups.push(() => f.cleanup());
    await f.addTask("ready-task", { "ok.txt": "clean\n" });
    const detachedUnmerged = join(f.root, "detached-unmerged");
    f.git(["worktree", "add", "--detach", detachedUnmerged, "HEAD"]);
    await writeFile(join(detachedUnmerged, "detached.txt"), "unmerged change\n");
    f.git(["add", "detached.txt"], detachedUnmerged);
    f.git(["commit", "-m", "detached commit"], detachedUnmerged);
    f.rows.push({ path: detachedUnmerged, branch: "detached", primary: false, state: "UNKNOWN", dirty: 0 });

    const detachedMerged = join(f.root, "detached-merged");
    f.git(["worktree", "add", "--detach", detachedMerged, "HEAD"]);
    f.rows.push({ path: detachedMerged, branch: "detached", primary: false, state: "UNKNOWN", dirty: 0 });

    const status = await inspectRepository(f.repo, { readStatus: f.readStatus });
    expect(status.incomplete).toBe(false);
    expect(status.worktrees.find((w) => w.branch === "codex/ready-task").category).toBe("ready");
    const unmergedWt = status.worktrees.find((w) => w.path === detachedUnmerged);
    expect(unmergedWt.preview).toBeNull();
    expect(unmergedWt.inspectionError).toBeUndefined();
    expect(unmergedWt.category).toBe("attention");
    expect(unmergedWt.reason).toContain("detached HEAD");
    const mergedWt = status.worktrees.find((w) => w.path === detachedMerged);
    expect(mergedWt.category).toBe("finished");
  });

  it("rejects fresh blocked finish on a re-queued assignment and survives NTP backward clock steps in executions", async () => {
    const dir = await makeTempDir("mm-workflow-clock-");
    let nowMs = Date.parse("2026-11-22T12:00:00.000Z");
    const assignments = await createAssignmentStore(join(dir, "assignments.json"));
    const board = await createBoardStore(join(dir, "board.json"));
    const executions = await createExecutionStore(join(dir, "runtime", "executions.json"), {
      clock: () => nowMs,
      leaseMs: 120_000,
    });
    const monitor = { repo: () => {} };
    for (const a of ["worker", "reviewer"]) {
      await board.command("check-in", { project: "demo", agent: a, task: "t", scope: "", state: "working" });
    }
    const created = await assignments.create({
      title: "Clock and workflow test",
      project: "demo",
      purpose: "Test invariants",
      owner: "worker",
      model: "synthetic",
      reviewer: "reviewer",
      scope: "server/",
      acceptance: "Passes",
      budget: "Local",
    });
    const workflow = createTeamWorkflow({ monitor, assignments, board, executions });
    const run = await workflow.claim({
      project: "demo",
      agent: "worker",
      assignmentId: created.id,
      requestId: randomUUID(),
    });
    // Step clock backward by 5 minutes (simulating NTP adjustment)
    nowMs -= 300_000;
    const started = await workflow.start({
      project: "demo",
      agent: "worker",
      runId: run.runId,
      adapter: "synthetic",
    });
    expect(Date.parse(started.updatedAt)).toBeGreaterThanOrEqual(Date.parse(started.createdAt));
    expect(Date.parse(started.leaseUntil)).toBeGreaterThan(Date.parse(started.createdAt));

    // Move assignment back to blocked -> queued via operator update, then try fresh blocked finish
    const current = assignments.list()[0];
    const blocked = await assignments.update({
      id: current.id,
      revision: current.revision,
      status: "blocked",
      summary: "Operator paused",
      artifacts: [],
      reviewNote: "",
    });
    await assignments.update({
      id: blocked.id,
      revision: blocked.revision,
      status: "queued",
      summary: "Operator re-queued",
      artifacts: [],
      reviewNote: "",
    });
    await expect(
      workflow.finish({
        project: "demo",
        agent: "worker",
        runId: run.runId,
        status: "blocked",
        summary: "Stale worker blocked",
        artifacts: [],
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(assignments.list()[0].status).toBe("queued");
  });

  it("prevents duplicate timer loops across rapid worker stop/start cycles", async () => {
    const dir = await makeTempDir("mm-worker-gen-");
    const store = await createStateStore(join(dir, "state.json"));
    await store.update((s) => ({ ...s, enabled: true }));
    let releaseFirst;
    let refreshCount = 0;
    const monitor = {
      config: { repos: [{ id: "demo", label: "Demo", excludedBranches: [] }] },
      store,
      refresh: async () => {
        refreshCount++;
        if (refreshCount === 1) {
          await new Promise((r) => {
            releaseFirst = r;
          });
        }
        return { baseSha: "a".repeat(40), worktrees: [], degraded: null, housekeeping: [] };
      },
      record: async () => {},
      runPreview: async () => {},
    };
    const worker = createWorker(monitor, { interval: 40, reap: null });
    worker.start();
    await new Promise((r) => setTimeout(r, 10));
    worker.stop();
    worker.start();
    releaseFirst();
    await new Promise((r) => setTimeout(r, 110));
    worker.stop();
    // With 40ms interval over ~110ms, a single timer runs at most ~4 times; duplicate loops would double it.
    expect(refreshCount).toBeLessThanOrEqual(4);
  });

  it("hardens dispatcher escalation retry/fallback/anti-spam, inbox truncation, AppleScript argv, and lock-before-load", async () => {
    const agent = { boardAgent: "op-helper", project: "example", harness: "opencode", cwd: "/Users/test/repo" };
    const config = validateConfig({ agents: [agent], claimDeadlineSeconds: 60 });
    const key = "example:op-helper:a-1@1";

    // Truncated inbox must NOT mark missing wake as claimed
    const truncatedState = { wakes: { [key]: { at: new Date(0).toISOString(), claimed: false, escalated: false } } };
    const truncatedInboxes = new Map([
      ["example:op-helper", { assignments: [], counts: { assignments: 25, reviews: 0 } }],
    ]);
    expect(pendingClaims(config, truncatedInboxes, truncatedState, 61_000)).toEqual([]);
    expect(truncatedState.wakes[key].claimed).toBe(false);

    // Completed ESCALATED wake transitions to claimed: true so pruneWakes can reclaim it
    const escalatedDoneState = { wakes: { [key]: { at: new Date(0).toISOString(), claimed: false, escalated: true } } };
    const emptyUntruncated = new Map([
      ["example:op-helper", { assignments: [], counts: { assignments: 0, reviews: 0 } }],
    ]);
    expect(pendingClaims(config, emptyUntruncated, escalatedDoneState, 61_000)).toEqual([]);
    expect(escalatedDoneState.wakes[key].claimed).toBe(true);

    // Escalation retry: transient outage does not mark escalated, notifies only once; 409 unchecked-in falls back to human
    const wakes = { [key]: { at: new Date(0).toISOString(), claimed: false, escalated: false } };
    const item = { agent, key, id: "a-1", role: "owner" };
    const notifications = [];
    const r1 = await escalate(config, [item], {
      post: async () => {
        throw new Error("temporary 503");
      },
      notify: async (t) => notifications.push(t),
      log: () => {},
      wakes,
    });
    expect(r1.escalatedKeys).toEqual([]);
    expect(r1.notifiedKeys).toEqual([key]);
    wakes[key].notified = true;

    const posted = [];
    const r2 = await escalate(config, [item], {
      post: async (msg) => {
        if (msg.to === "op-helper") throw new Error("The recipient must check in to this project first.");
        posted.push(msg);
      },
      notify: async (t) => notifications.push(t),
      log: () => {},
      wakes,
    });
    expect(r2.escalatedKeys).toEqual([key]);
    expect(r2.notifiedKeys).toEqual([]);
    expect(notifications).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ to: "human", kind: "blocker", attention: "action" });
    expect(posted[0].requestId).toMatch(/^[a-f0-9-]{36}$/);

    // AppleScript openChat & defaultNotify pass untrusted strings via -- argv and capture targetWindow
    const osaCalls = [];
    await openChat(agent, 'hello "quoted" \n -leading-dash', (bin, args, cb) => {
      osaCalls.push({ bin, args });
      cb(null);
    });
    expect(osaCalls[0].bin).toBe("osascript");
    expect(osaCalls[0].args).toContain("on run argv");
    expect(osaCalls[0].args).toContain("set targetWindow to (create window with default profile)");
    expect(osaCalls[0].args).toContain("tell current session of targetWindow to write text cmd");
    const dashIdx = osaCalls[0].args.indexOf("--");
    expect(dashIdx).toBeGreaterThan(0);
    expect(osaCalls[0].args[dashIdx + 1]).toContain('hello "quoted"');

    await defaultNotify('Alert "test"', (bin, args, cb) => {
      osaCalls.push({ bin, args });
      cb(null);
    });
    expect(osaCalls[1].args).toContain("on run argv");
    expect(osaCalls[1].args.at(-2)).toBe("--");
    expect(osaCalls[1].args.at(-1)).toBe('Alert "test"');

    // Lock-before-load: live lock rejects BEFORE reading corrupt state file
    const dir = await makeTempDir("mm-lock-order-");
    const configPath = join(dir, "dispatch.json");
    const statePath = join(dir, "state.json");
    const lockPath = `${statePath}.lock`;
    await writeFile(configPath, JSON.stringify({ agents: [agent] }), { mode: 0o600 });
    await writeFile(statePath, "{corrupt-json", { mode: 0o600 });
    await writeFile(lockPath, String(process.pid), { mode: 0o600 });
    await expect(
      runDispatch({ configPath, statePath, lockPath, once: true, log: () => {} }),
    ).rejects.toThrow(/Another dispatcher/);
  });

  it("runs agent-check.mjs directly when invoked via relative path", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["./scripts/agent-check.mjs", "--help"], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    expect(stdout).toContain("--repo ID");
  });
});

describe("Track 4: LaunchAgent neutral labels, atomic plist lint-before-unload, and superseded migration", () => {
  it("validates serviceLabelSetting and parses formatted XML in staleHoursSetting", () => {
    expect(serviceLabelSetting(undefined)).toBe(DEFAULT_SERVICE_LABEL);
    expect(serviceLabelSetting("")).toBe("local.merge-monitor");
    expect(serviceLabelSetting("local.custom.mm")).toBe("local.custom.mm");
    expect(() => serviceLabelSetting("../bad label")).toThrow(/MERGE_MONITOR_SERVICE_LABEL/);

    const formatted = `<dict>\n  <key>MERGE_MONITOR_STALE_HOURS</key>\n  <string>36</string>\n</dict>`;
    expect(staleHoursSetting(undefined, formatted)).toBe("36");
    const badFormatted = `<dict>\n  <key>MERGE_MONITOR_STALE_HOURS</key>\n  <string>Infinity</string>\n</dict>`;
    expect(staleHoursSetting(undefined, badFormatted)).toBe("");
    const sciFormatted = `<dict>\n  <key>MERGE_MONITOR_STALE_HOURS</key>\n  <string>1e3</string>\n</dict>`;
    expect(staleHoursSetting(undefined, sciFormatted)).toBe("");
  });

  it("discovers superseded LaunchAgents targeting the same script, refuses symlink overwrites, and removes superseded dispatch plists when config is absent", async () => {
    const dir = await makeTempDir("mm-launch-");
    const agentsDir = join(dir, "LaunchAgents");
    await writeFile(join(dir, "dummy"), "x", { mode: 0o600 });
    await mkdir(agentsDir, { recursive: true });

    const root = "/Users/test/code/merge-monitor";
    const oldServerXml = renderServerPlist({
      label: "local.legacy.merge-monitor",
      nodePath: "/usr/local/bin/node",
      root,
      port: 5173,
      pathEnv: "/usr/bin",
      staleHours: "48",
      stdoutPath: "/tmp/out.log",
      stderrPath: "/tmp/err.log",
    });
    const oldServerPath = join(agentsDir, "local.legacy.merge-monitor.plist");
    await writeFile(oldServerPath, oldServerXml, { mode: 0o600 });

    const oldDispatchXml = renderDispatchPlist({
      label: "local.legacy.merge-monitor.dispatch",
      nodePath: "/usr/local/bin/node",
      root,
      configPath: "/Users/test/.config/merge-monitor/dispatch.json",
      origin: "http://127.0.0.1:5173",
      statePath: "/Users/test/.local/state/merge-monitor/dispatch-state.json",
      pathEnv: "/usr/bin",
      stdoutPath: "/tmp/d.out.log",
      stderrPath: "/tmp/d.err.log",
    });
    const oldDispatchPath = join(agentsDir, "local.legacy.merge-monitor.dispatch.plist");
    await writeFile(oldDispatchPath, oldDispatchXml, { mode: 0o600 });

    // Symlink and binary plists in LaunchAgents must be safely skipped
    await symlink(oldServerPath, join(agentsDir, "symlink.plist"));
    await writeFile(join(agentsDir, "binary.plist"), Buffer.from([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x00]));

    const supersededServers = await findSupersededLaunchAgents(
      agentsDir,
      resolve(root, "server/index.mjs"),
      DEFAULT_SERVICE_LABEL,
    );
    expect(supersededServers.map((s) => s.label)).toEqual(["local.legacy.merge-monitor"]);

    // If plutil -lint fails, superseded and live LaunchAgents must NOT be unloaded!
    const calls = [];
    await expect(
      reinstallLaunchAgent({
        uid: 501,
        label: DEFAULT_SERVICE_LABEL,
        plistPath: join(agentsDir, `${DEFAULT_SERVICE_LABEL}.plist`),
        plistXml: "<broken",
        superseded: supersededServers,
        execute: async (cmd, args) => {
          calls.push([cmd, ...args]);
          if (cmd === "plutil") throw new Error("lint failed");
          return { stdout: "", stderr: "" };
        },
      }),
    ).rejects.toThrow(/lint failed/);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("plutil");

    // Refuses to overwrite a symlink target plist
    const symTarget = join(agentsDir, "sym-target.plist");
    await symlink(join(dir, "dummy"), symTarget);
    await expect(
      reinstallLaunchAgent({
        uid: 501,
        label: "local.sym",
        plistPath: symTarget,
        plistXml: "<plist/>",
        execute: async (cmd, args) => {
          if (cmd === "launchctl" && args[0] === "print")
            throw Object.assign(new Error("gone"), { code: 113 });
          return { stdout: "", stderr: "" };
        },
      }),
    ).rejects.toThrow(/non-regular plist/);

    // syncDispatchLaunchAgent with dispatchConfig: null removes superseded dispatch plist too
    const removed = await syncDispatchLaunchAgent({
      dispatchConfig: null,
      configPath: join(dir, "missing.json"),
      execute: async (cmd, args) => {
        if (cmd === "launchctl" && args[0] === "print")
          throw Object.assign(new Error("gone"), { code: 113 });
        return { stdout: "", stderr: "" };
      },
      uid: 501,
      agentsDir,
      nodePath: "/usr/local/bin/node",
      root,
      origin: "http://127.0.0.1:5173",
      statePath: join(dir, "dispatch-state.json"),
      pathEnv: "/usr/bin",
      logsDir: dir,
    });
    expect(removed.removed).toBe(true);
    await expect(stat(oldDispatchPath)).rejects.toThrow();
  });
});
