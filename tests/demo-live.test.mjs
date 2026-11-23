import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../server/config.mjs";
import { startServer } from "../server/index.mjs";
import { parseDemoPort, startDemo } from "../scripts/demo-live.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const cleanups = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    await fn().catch(() => undefined);
  }
});

describe("first-run config ergonomics and port parsing", () => {
  it("gives actionable guidance mentioning npm run demo when monitor.config.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merge-monitor-missing-cfg-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let caught;
    try {
      await loadConfig(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain("npm run demo");
    expect(caught.message).toContain("monitor.config.example.json");
    expect(caught.cause?.code).toBe("ENOENT");
  });

  it("parses demo ports cleanly including 0 without falsy fallback", () => {
    expect(parseDemoPort([], {})).toBe(5174);
    expect(parseDemoPort([], { PORT: "" })).toBe(5174);
    expect(parseDemoPort([], { PORT: "0" })).toBe(0);
    expect(parseDemoPort(["--port", "0"], { PORT: "5180" })).toBe(0);
    expect(parseDemoPort(["--port=5190"], {})).toBe(5190);
    expect(() => parseDemoPort(["--port"], {})).toThrow(/Missing value/);
    expect(() => parseDemoPort(["--port", "-1"], {})).toThrow(/Invalid port/);
    expect(() => parseDemoPort(["--port", "65536"], {})).toThrow(/Invalid port/);
    expect(() => parseDemoPort([], { PORT: "abc" })).toThrow(/Invalid port/);
  });
});

describe("one-command disposable live demo (scripts/demo-live.mjs)", () => {
  it("seeds synthetic board, assignments, and live cross-worktree overlap, then cleans up temp dir", async () => {
    const demo = await startDemo({ root: REPO_ROOT, port: 0 });
    cleanups.push(() => demo.close());

    const healthRes = await fetch(`${demo.url}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health.ok).toBe(true);

    const boardRes = await fetch(`${demo.url}/api/board?project=demo-app`);
    expect(boardRes.status).toBe(200);
    const board = await boardRes.json();
    expect(board.room.goal).toContain("webhook retry hardening");
    expect(board.room.members).toHaveLength(4);
    expect(board.room.members.some((m) => m.agent === "docs-helper" && m.state === "done")).toBe(true);

    const handoff = board.room.messages.find((m) => m.kind === "handoff");
    expect(handoff).toBeTruthy();
    expect(handoff.attention).toBe("action");
    expect(handoff.acknowledgedAt).not.toBe("");
    expect(handoff.resolvedAt).toBe("");
    expect(Object.keys(handoff.finding).sort()).toEqual([
      "actual",
      "claim",
      "doneCheck",
      "evidence",
      "expected",
      "scope",
      "severity",
    ]);

    const question = board.room.messages.find((m) => m.kind === "question");
    expect(question?.to).toBe("human");
    expect(question?.attention).toBe("action");

    const assignmentsRes = await fetch(`${demo.url}/api/assignments`);
    expect(assignmentsRes.status).toBe(200);
    const assignmentsData = await assignmentsRes.json();
    expect(assignmentsData.assignments).toHaveLength(2);
    const reviewItem = assignmentsData.assignments.find((a) => a.status === "review");
    expect(reviewItem?.owner).toBe("claude-builder");
    expect(reviewItem?.reviewer).toBe("codex-reviewer");
    expect(reviewItem?.artifacts[0]).toBe(join(demo.repoDir, "src/billing/webhook.ts"));
    const workingItem = assignmentsData.assignments.find((a) => a.status === "working");
    expect(workingItem?.owner).toBe("opencode-tests");

    const statusRes = await fetch(`${demo.url}/api/status?repo=demo-app`);
    expect(statusRes.status).toBe(200);
    const statusPayload = await statusRes.json();
    const status = statusPayload.status;
    expect(status).toBeTruthy();
    expect(status.conflicts.some((c) => c.file === "src/billing/webhook.ts")).toBe(true);
    const retriesWt = status.worktrees.find((w) => w.branch === "fix/webhook-retries");
    const rateWt = status.worktrees.find((w) => w.branch === "feat/rate-limit-guard");
    const docsWt = status.worktrees.find((w) => w.branch === "docs/webhook-notes");
    expect(retriesWt?.overlappingFiles).toContain("src/billing/webhook.ts");
    expect(rateWt?.overlappingFiles).toContain("src/billing/webhook.ts");
    expect(retriesWt?.category).toBe("attention");
    expect(rateWt?.category).toBe("attention");
    expect(docsWt?.overlappingFiles).toEqual([]);

    const tempRoot = demo.tempRoot;
    await demo.close();
    await expect(stat(tempRoot)).rejects.toThrow();
  });

  it("cleans up temp directory when port is already occupied (EADDRINUSE)", async () => {
    const blocker = createServer();
    await new Promise((accept) => blocker.listen(0, "127.0.0.1", accept));
    cleanups.push(
      () =>
        new Promise((accept) => {
          blocker.close(() => accept());
        }),
    );
    const beforeDirs = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith("merge-monitor-demo-")),
    );
    const occupiedPort = blocker.address().port;
    let caught;
    try {
      await startDemo({ root: REPO_ROOT, port: occupiedPort });
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe("EADDRINUSE");
    const afterDirs = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("merge-monitor-demo-") && !beforeDirs.has(name),
    );
    expect(afterDirs).toEqual([]);
  });

  it("closes promptly in development:true mode even while an upgraded WebSocket/HMR connection is open", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "merge-monitor-dev-close-"));
    cleanups.push(() => rm(tempDir, { recursive: true, force: true }));
    const repoDir = join(tempDir, "repo");
    await mkdir(repoDir);
    execFileSync(
      "git",
      ["-c", "init.defaultBranch=main", "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "init"],
      { cwd: repoDir, stdio: "pipe" },
    );
    await writeFile(join(repoDir, "README.md"), "# test\n");
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "add", "."],
      { cwd: repoDir, stdio: "pipe" },
    );
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "init"],
      { cwd: repoDir, stdio: "pipe" },
    );
    const configPath = join(tempDir, "monitor.config.json");
    const stateDir = join(tempDir, "state");
    await mkdir(stateDir, { mode: 0o700 });
    await writeFile(
      configPath,
      JSON.stringify({ repos: [{ id: "repo", label: "Repo", path: repoDir, defaultBranch: "main" }], defaultRepo: "repo" }),
    );

    const started = await startServer({
      root: REPO_ROOT,
      port: 0,
      configPath,
      statePath: join(stateDir, "state.json"),
      startWorker: false,
      development: true,
    });
    cleanups.push(() => started.close());

    const port = started.server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), 3000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        accept();
      });
      ws.addEventListener("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const closeStart = Date.now();
    await started.close();
    const elapsedMs = Date.now() - closeStart;
    expect(elapsedMs).toBeLessThan(5000);
    // Calling close() a second time must be idempotent.
    await expect(started.close()).resolves.toBeUndefined();
    ws.close();
  });

  it("runs upgraded scripts/demo-handoff.mjs cleanly with 409 reply-before-resolve proof", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(REPO_ROOT, "scripts/demo-handoff.mjs")],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(out);
    expect(parsed.outcome).toBe("passed");
    expect(parsed.prematureResolve.statusCode).toBe(409);
    expect(parsed.messages[0].finding.severity).toBe("blocking");
  });
});
