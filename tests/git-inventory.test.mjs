import { afterEach, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import { contract } from "../server/contract.mjs";
import { failureReason } from "../server/git.mjs";
import { repository } from "./fixtures.mjs";
import { readWorktreeInventory } from "../server/git-inventory.mjs";
import { inspectRepository } from "../server/inspection.mjs";

const fixtures = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.cleanup())); });
const missingCommand = async () => { throw new Error("Command missing", { cause: { code: "ENOENT" } }); };

it("uses real Git worktrees when agent-task is absent, without claiming completion", async () => {
  const f = await repository();
  fixtures.push(f);
  await f.addTask("portable", { "portable.txt": "change\n" });
  const readStatus = (repo) => readWorktreeInventory(repo, { run: missingCommand });
  const inventory = await readStatus(f.repo);
  expect(inventory.worktrees).toHaveLength(2);
  expect(inventory.worktrees[0].primary).toBe(true);
  const report = await inspectRepository(f.repo, { readStatus });
  const task = report.worktrees.find((row) => row.branch === "codex/portable");
  expect(task.changedFiles).toEqual(["portable.txt"]);
  expect(task.preview.outcome).toBe("clean");
  expect(task.state).toBe("UNKNOWN");
  expect(task.category).not.toBe("ready");
  expect(task.checks).toBe("not-run");
});

it("does not hide a failed or malformed agent-task response", async () => {
  await expect(readWorktreeInventory({}, { run: async () => { throw new Error("timed out"); } })).rejects.toThrow("timed out");
  await expect(readWorktreeInventory({}, { run: async () => ({ stdout: "invalid" }) })).rejects.toThrow();
});

// Mirrors the error command() raises when agent-task exits non-zero.
const refused = (stderr) => async () => {
  const cause = Object.assign(new Error("Command failed"), { code: 2, stderr, stdout: "" });
  throw new Error(`agent-task inspection failed (exit 2): ${failureReason(cause)}`, { cause });
};

it("reports a stale worktree record and still inspects the remaining worktrees", async () => {
  const f = await repository();
  fixtures.push(f);
  await f.addTask("kept", { "kept.txt": "change\n" });
  const gone = await f.addTask("gone", { "gone.txt": "change\n" });
  await rm(gone, { recursive: true, force: true });
  const readStatus = (repo) => readWorktreeInventory(repo, { run: refused(`BLOCKED: Not a Git repository: ${gone}\n`) });
  const report = await inspectRepository(f.repo, { readStatus });
  expect(report.worktrees.map((row) => row.branch).sort()).toEqual(["codex/kept", "main"]);
  expect(report.incomplete).toBe(false);
  expect(report.degraded).toContain(`BLOCKED: Not a Git repository: ${gone}`);
  expect(report.degraded).toContain("task completion is unknown");
  expect(report.housekeeping).toEqual([expect.objectContaining({ kind: "stale-worktree", path: gone })]);
  expect(report.housekeeping[0].message).toContain("git worktree prune");
  expect(report.worktrees.every((row) => row.category !== "ready")).toBe(true);
  const check = new Ajv({ strict: false }).compile({ ...contract.components.schemas.Status, components: contract.components });
  expect(check(report), JSON.stringify(check.errors)).toBe(true);
  // Read-only: the stale record stays for the owner to prune.
  expect(f.git(["worktree", "list", "--porcelain"])).toContain("prunable");
});

it("keeps the agent-task reason when the Git fallback also fails", async () => {
  await expect(readWorktreeInventory({ path: "/nonexistent/merge-monitor-repo" }, { run: refused("BLOCKED: broken\n") }))
    .rejects.toThrow(/exit 2\): BLOCKED: broken.*Git fallback also failed/);
});

it("flags a stale worktree record even when agent-task succeeds", async () => {
  const f = await repository();
  fixtures.push(f);
  await f.addTask("kept", { "kept.txt": "change\n" });
  const gone = await f.addTask("gone", { "gone.txt": "change\n" });
  await rm(gone, { recursive: true, force: true });
  // agent-task tolerates the record and still lists it as a task.
  const run = async () => ({ stdout: JSON.stringify({ worktrees: f.rows }) });
  const readStatus = (repo) => readWorktreeInventory(repo, { run });
  const report = await inspectRepository(f.repo, { readStatus });
  expect(report.worktrees.map((row) => row.branch).sort()).toEqual(["codex/kept", "main"]);
  expect(report.worktrees.find((row) => row.branch === "codex/kept").state).toBe("COMPLETE");
  expect(report.degraded).toBeUndefined();
  expect(report.incomplete).toBe(false);
  expect(report.housekeeping).toEqual([expect.objectContaining({ kind: "stale-worktree", path: gone })]);
  expect(f.git(["worktree", "list", "--porcelain"])).toContain("prunable");
});

it("reports no housekeeping when agent-task succeeds on a tidy repository", async () => {
  const f = await repository();
  fixtures.push(f);
  const run = async () => ({ stdout: JSON.stringify({ worktrees: f.rows }) });
  const inventory = await readWorktreeInventory(f.repo, { run });
  expect(inventory.housekeeping).toEqual([]);
  expect(inventory.worktrees).toEqual(f.rows);
});
