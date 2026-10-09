import { afterEach, expect, it } from "vitest";
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
