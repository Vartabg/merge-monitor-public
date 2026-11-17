import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewWakePrompt,
  buildWakePrompt,
  boundedReview,
  escalate,
  extractContendedFiles,
  freeDiskGiB,
  loadState,
  pendingClaims,
  planWakes,
  reviewWakeKey,
  runDispatch,
  validateConfig,
} from "../scripts/dispatch.mjs";
import { workerClient } from "../scripts/worker-client.mjs";
import { reapMergedWorktrees } from "../server/git-inventory.mjs";
import { createWorker } from "../server/worker.mjs";
import { createStateStore } from "../server/state.mjs";
import { repo, primary, ready, response } from "./ui-fixtures";

const tempDirs = [];
const servers = [];

afterEach(async () => {
  await Promise.all([
    ...tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
    ...servers
      .splice(0)
      .map((srv) => new Promise((done) => srv.close(() => done()))),
  ]);
});

const baseAgent = {
  boardAgent: "coder-mid",
  project: "merge-monitor",
  harness: "opencode",
  cwd: "/Users/test/code/merge-monitor",
};
const reviewerAgent = {
  boardAgent: "reviewer-top",
  project: "merge-monitor",
  harness: "muse",
  cwd: "/Users/test/code/merge-monitor",
};
const baseAssignment = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: "coder-mid",
  reviewer: "reviewer-top",
  status: "queued",
  revision: 2,
  title: "Implement airway gate",
  purpose: "Prevent low-disk agent wakes",
  scope: "scripts/dispatch.mjs",
  acceptance: "npm run verify passes",
};
const baseReview = {
  ...baseAssignment,
  status: "review",
  revision: 3,
  summary: "Implemented disk gate and added regression tests.",
  artifacts: ["/tmp/verify.log", "https://example.com/pr/40"],
};

it("validates workerClient.status repository IDs and formats the status endpoint", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ repoId: "mm" })));
  const client = workerClient("http://127.0.0.1:5173", fetcher);
  expect(() => client.status("")).toThrow(/repository ID/);
  expect(() => client.status(undefined)).toThrow(/repository ID/);
  expect(fetcher).not.toHaveBeenCalled();

  await expect(client.status("a & b")).resolves.toEqual({ repoId: "mm" });
  expect(fetcher.mock.calls[0][0]).toBe(
    "http://127.0.0.1:5173/api/status?repo=a+%26+b",
  );
});

it("validates minFreeDiskGiB bounds and measures statfs free space with number or bigint metrics", async () => {
  expect(validateConfig({ agents: [baseAgent] }).minFreeDiskGiB).toBe(50);
  expect(
    validateConfig({ agents: [baseAgent], minFreeDiskGiB: 25 }).minFreeDiskGiB,
  ).toBe(25);
  for (const bad of [0, -5, 501, 12.5, "50"]) {
    expect(() =>
      validateConfig({ agents: [baseAgent], minFreeDiskGiB: bad }),
    ).toThrow(/minFreeDiskGiB/);
  }

  const giB = 1024 ** 3;
  expect(
    await freeDiskGiB("/tmp", async () => ({
      bavail: (80 * giB) / 4096,
      bsize: 4096,
    })),
  ).toBeCloseTo(80, 5);
  expect(
    await freeDiskGiB("/tmp", async () => ({
      bavail: 20n * 1024n * 256n,
      bsize: 4096n,
    })),
  ).toBeCloseTo(20, 5);
  await expect(
    freeDiskGiB("/tmp", async () => ({ bavail: -1, bsize: 4096 })),
  ).rejects.toThrow(/invalid/);
  await expect(
    freeDiskGiB("/tmp", async () => ({ bavail: 100n, bsize: 0n })),
  ).rejects.toThrow(/invalid/);
});

it("extracts bounded airspace conflict advisories only from fresh complete status responses", () => {
  const conflicts = Array.from({ length: 12 }, (_, i) => ({
    file: `  src/file-${i}.ts  `,
    branches: ["a", "b"],
  }));
  conflicts.push({ file: "src/file-0.ts", branches: ["a", "c"] });
  expect(
    extractContendedFiles({
      stale: false,
      error: null,
      status: { incomplete: false, conflicts },
    }),
  ).toHaveLength(8);
  expect(
    extractContendedFiles({
      stale: true,
      status: { incomplete: false, conflicts },
    }),
  ).toEqual([]);
  expect(
    extractContendedFiles({
      stale: false,
      error: "timeout",
      status: { incomplete: false, conflicts },
    }),
  ).toEqual([]);
  expect(
    extractContendedFiles({
      stale: false,
      error: null,
      status: { incomplete: true, conflicts },
    }),
  ).toEqual([]);

  const withConflict = buildWakePrompt(baseAgent, baseAssignment, {
    contendedFiles: ["server/worker.mjs"],
  });
  expect(withConflict).toContain(
    "Airspace advisory: active branches currently overlap on [server/worker.mjs]",
  );
  const cleanPrompt = buildWakePrompt(baseAgent, baseAssignment);
  expect(cleanPrompt).not.toContain("Airspace advisory:");
});

it("validates boundedReview against assignment schema limits and formats safety-bounded reviewer prompts", () => {
  const longArtifact = `/${"a".repeat(1023)}`;
  expect(longArtifact).toHaveLength(1024);
  expect(
    boundedReview({
      ...baseReview,
      summary: "x".repeat(1200),
      artifacts: [longArtifact],
    }).artifacts[0],
  ).toHaveLength(1024);

  expect(() =>
    boundedReview({ ...baseReview, artifacts: [`${longArtifact}z`] }),
  ).toThrow(/artifact/);
  expect(() =>
    boundedReview({ ...baseReview, summary: "x".repeat(1201) }),
  ).toThrow(/summary/);
  expect(() => boundedReview({ ...baseReview, owner: "" })).toThrow(/owner/);

  const prompt = buildReviewWakePrompt(reviewerAgent, baseReview);
  expect(prompt).toContain("Do not call team_claim on an assignment in review.");
  expect(prompt).toContain("Worker summary (unverified report):");
  expect(prompt).toContain("Artifacts (unverified paths/URLs):");
  expect(prompt).toContain("team-queue at revision 3");
  expect(prompt).toContain("Do not merge, push to the default branch, or deploy");
});

it("plans, tracks deadlines, and escalates owner and reviewer wakes independently", async () => {
  const config = validateConfig({
    agents: [baseAgent, reviewerAgent],
    claimDeadlineSeconds: 60,
  });
  const reviewOnlyInbox = new Map([
    [
      "merge-monitor:reviewer-top",
      {
        reviews: [baseReview, { ...baseReview, id: "bad", summary: 42 }],
      },
    ],
  ]);
  const planned = planWakes(config, reviewOnlyInbox, { wakes: {} });
  expect(planned).toHaveLength(1);
  expect(planned[0].role).toBe("reviewer");
  expect(planned[0].key).toBe(reviewWakeKey(reviewerAgent, baseReview));

  const rKey = planned[0].key;
  const state = {
    wakes: {
      [rKey]: {
        at: new Date(0).toISOString(),
        claimed: false,
        escalated: false,
      },
    },
  };
  const missingReviewsInbox = new Map([
    ["merge-monitor:reviewer-top", { assignments: [] }],
  ]);
  expect(pendingClaims(config, missingReviewsInbox, state, 61_000)).toEqual([]);
  expect(state.wakes[rKey].claimed).toBe(false);

  const pending = pendingClaims(config, reviewOnlyInbox, state, 61_000);
  expect(pending).toHaveLength(1);
  expect(pending[0].role).toBe("reviewer");

  const posts = [];
  const notifications = [];
  await escalate(config, pending, {
    post: async (msg) => posts.push(msg),
    notify: async (msg) => notifications.push(msg),
    log: () => {},
  });
  expect(posts[0].text).toContain("still awaiting review (status review)");
  expect(posts[0].text).not.toContain("team_claim");
  expect(notifications[0]).toContain("has not reviewed assignment");

  const movedOnInbox = new Map([
    ["merge-monitor:reviewer-top", { reviews: [] }],
  ]);
  expect(pendingClaims(config, movedOnInbox, state, 61_000)).toEqual([]);
  expect(state.wakes[rKey].claimed).toBe(true);
});

it("runs end-to-end dispatch with disk backpressure, hold recovery, board-post resilience, airspace advisories, and reviewer wakes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atc-dispatch-"));
  tempDirs.push(dir);
  const configPath = join(dir, "dispatch.json");
  const statePath = join(dir, "state.json");
  const lockPath = join(dir, "lock");

  await writeFile(
    configPath,
    JSON.stringify({
      agents: [baseAgent, reviewerAgent],
      minFreeDiskGiB: 50,
      maxWakesPerCycle: 5,
    }),
    { mode: 0o600 },
  );

  const boardPosts = [];
  let failNextPost = true;
  const ownerInboxAssignments = [baseAssignment];
  const reviewerInboxReviews = [baseReview];
  const currentConflicts = [{ file: "server/worker.mjs", branches: ["a", "b"] }];
  const validBoardResponse = {
    room: {
      project: "merge-monitor",
      goal: "",
      goalBy: "",
      goalAt: "",
      revision: 0,
      members: [],
      messages: [],
    },
    asOf: new Date().toISOString(),
    unreadIds: [],
    pendingIds: [],
    staleAfterHours: 72,
    staleAgents: [],
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rawBody = "";
    for await (const chunk of req) rawBody += chunk;
    const json = (code, payload) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/api/session") return json(200, { token: "t".repeat(64) });
    if (url.pathname === "/api/board/check-in") return json(200, validBoardResponse);
    if (url.pathname === "/api/board/post") {
      if (failNextPost) return json(503, { error: "temporary outage" });
      boardPosts.push(JSON.parse(rawBody));
      return json(200, validBoardResponse);
    }
    if (url.pathname === "/api/status") {
      return json(200, {
        repoId: "merge-monitor",
        stale: false,
        error: null,
        status: { incomplete: false, conflicts: currentConflicts },
      });
    }
    if (url.pathname === "/api/team/inbox") {
      const agent = url.searchParams.get("agent");
      return json(200, {
        version: 1,
        assignments: agent === "coder-mid" ? ownerInboxAssignments : [],
        reviews: agent === "reviewer-top" ? reviewerInboxReviews : [],
      });
    }
    return json(404, { error: "not found" });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const opened = [];
  const notifications = [];
  let simulatedDiskGiB = 12;

  // Cycle 1: low disk + failing board("post") -> fails closed, does not wake, leaves escalated: false, notifies once
  await runDispatch({
    configPath,
    origin,
    statePath,
    lockPath,
    once: true,
    diskFreeGiB: async () => simulatedDiskGiB,
    open: async (agent, prompt) => opened.push({ agent, prompt }),
    notify: async (msg) => notifications.push(msg),
    log: () => {},
  });
  expect(opened).toHaveLength(0);
  expect(boardPosts).toHaveLength(0);
  expect(notifications).toHaveLength(1);
  let loaded = await loadState(statePath);
  expect(loaded.diskHolds["merge-monitor"].escalated).toBe(false);
  expect(loaded.diskHolds["merge-monitor"].notified).toBe(true);

  // Cycle 2: low disk persists, board("post") recovers -> posts blocker once without duplicating OS notification
  failNextPost = false;
  await runDispatch({
    configPath,
    origin,
    statePath,
    lockPath,
    once: true,
    diskFreeGiB: async () => simulatedDiskGiB,
    open: async (agent, prompt) => opened.push({ agent, prompt }),
    notify: async (msg) => notifications.push(msg),
    log: () => {},
  });
  expect(opened).toHaveLength(0);
  expect(boardPosts).toHaveLength(1);
  expect(boardPosts[0]).toMatchObject({ to: "human", kind: "blocker", attention: "action" });
  expect(notifications).toHaveLength(1);
  loaded = await loadState(statePath);
  expect(loaded.diskHolds["merge-monitor"].escalated).toBe(true);

  // Cycle 3: disk measurement error on coder-mid holds coder-mid without waking
  await runDispatch({
    configPath,
    origin,
    statePath,
    lockPath,
    once: true,
    diskFreeGiB: async () => {
      throw new Error("statfs failed");
    },
    open: async (agent, prompt) => opened.push({ agent, prompt }),
    notify: async () => {},
    log: () => {},
  });
  expect(opened).toHaveLength(0);

  // Cycle 4: disk recovers above 50 GiB -> hold clears, wakes both owner (with airspace advisory) and reviewer
  simulatedDiskGiB = 180;
  await runDispatch({
    configPath,
    origin,
    statePath,
    lockPath,
    once: true,
    diskFreeGiB: async () => simulatedDiskGiB,
    open: async (agent, prompt) => opened.push({ agent, prompt }),
    notify: async () => {},
    log: () => {},
  });
  expect(opened).toHaveLength(2);
  const ownerWake = opened.find((item) => item.agent.boardAgent === "coder-mid");
  const reviewWake = opened.find((item) => item.agent.boardAgent === "reviewer-top");
  expect(ownerWake.prompt).toContain("Airspace advisory: active branches currently overlap on [server/worker.mjs]");
  expect(reviewWake.prompt).toContain("Do not call team_claim on an assignment in review.");
  expect(reviewWake.prompt).toContain("Implemented disk gate and added regression tests.");
  loaded = await loadState(statePath);
  expect(loaded.diskHolds).toEqual({});
});

it("handles reapMergedWorktrees missing-binary and malformed output boundaries", async () => {
  const missing = await reapMergedWorktrees(
    { path: "/tmp/repo" },
    {
      run: async () => {
        throw new Error("missing", { cause: { code: "ENOENT" } });
      },
    },
  );
  expect(missing).toBeNull();

  await expect(
    reapMergedWorktrees({ path: "/tmp/repo" }, { run: async () => ({ stdout: "not-json" }) }),
  ).rejects.toThrow(/malformed JSON/);

  await expect(
    reapMergedWorktrees({ path: "/tmp/repo" }, { run: async () => ({ stdout: "{}" }) }),
  ).rejects.toThrow(/unsupported format/);

  const valid = await reapMergedWorktrees(
    { path: "/tmp/repo" },
    {
      run: async (cmd, args) => {
        expect(cmd).toBe("agent-task");
        expect(args).toEqual(["reap", "--repo", "/tmp/repo", "--json"]);
        expect(args).not.toContain("--force");
        return {
          stdout: JSON.stringify({
            reaped: [{ path: "/wt/1", branch: "codex/one", deleted_branch: true }],
          }),
        };
      },
    },
  );
  expect(valid).toEqual([{ path: "/wt/1", branch: "codex/one", deleted_branch: true }]);
});

it("sweeps merged clean unleased worktrees in createWorker and enforces excluded, active-run, and held-gate fences", async () => {
  const root = await mkdtemp(join(tmpdir(), "atc-worker-"));
  tempDirs.push(root);
  const store = await createStateStore(join(root, "state.json"));
  await store.update((s) => ({ ...s, enabled: true }));

  const mergedClean = {
    ...ready,
    path: "/tmp/wt-merged",
    branch: "codex/merged-task",
    headSha: "1".repeat(40),
    merged: true,
    isDirty: false,
    category: "finished",
    preview: null,
  };
  const excludedMerged = {
    ...mergedClean,
    path: "/tmp/wt-excluded",
    branch: "codex/excluded-parked",
    headSha: "2".repeat(40),
  };

  let activeRuns = [{ phase: "running", runId: "r1" }];
  const executions = { list: () => activeRuns };
  let worktrees = [primary, mergedClean, excludedMerged];
  let repoConfig = { ...repo, excludedBranches: [excludedMerged.branch] };
  const reap = vi.fn().mockResolvedValue([
    { path: mergedClean.path, branch: mergedClean.branch, deleted_branch: true },
  ]);

  const monitor = {
    config: { repos: [repoConfig], defaultRepo: repo.id },
    store,
    refresh: vi.fn(async () => ({
      ...response().status,
      worktrees: [...worktrees],
    })),
    record: vi.fn(async (event) => {
      await store.update((s) => ({
        ...s,
        history: [{ id: "e", at: new Date().toISOString(), ...event }, ...s.history],
      }));
    }),
    runPreview: vi.fn(),
  };

  const worker = createWorker(monitor, { reap, executions });

  // 1. Active RESERVING run prevents reap
  await worker.run();
  expect(reap).not.toHaveBeenCalled();

  // 2. Execution clears, but excluded merged worktree pauses repo-wide reap and records one notice
  activeRuns = [{ phase: "review", runId: "r1" }];
  await worker.run();
  await worker.run();
  expect(reap).not.toHaveBeenCalled();
  expect(
    store.get().history.filter((e) => e.message.includes("Auto-reap paused")),
  ).toHaveLength(1);

  // 3. Excluded worktree leaves excludedBranches -> mergedClean fails closed on cycle 3 -> recorded once in heldGates
  worktrees = [primary, mergedClean];
  reap.mockResolvedValueOnce([]);
  await worker.run();
  await worker.run();
  expect(reap).toHaveBeenCalledTimes(1);
  expect(
    store.get().history.filter((e) => e.message.includes("stayed parked")),
  ).toHaveLength(1);

  // 4. Missing agent-task binary (null) is a silent no-op for new commits
  worktrees = [primary, { ...mergedClean, headSha: "3".repeat(40) }];
  reap.mockResolvedValueOnce(null);
  await worker.run();
  expect(worker.view().error).toBeNull();

  // 5. Successful reap on next headSha records clean clear and refreshes status
  worktrees = [primary, { ...mergedClean, headSha: "4".repeat(40) }];
  reap.mockImplementationOnce(async () => {
    worktrees = [primary];
    return [{ path: mergedClean.path, branch: mergedClean.branch, deleted_branch: true }];
  });
  await worker.run();
  expect(
    store.get().history.some(
      (e) =>
        e.outcome === "clean" &&
        e.message.includes("Ground control cleared 1 merged worktree (codex/merged-task)."),
    ),
  ).toBe(true);
  worker.stop();
});
