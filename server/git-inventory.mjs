import { command, git } from "./git.mjs";

// Git can enumerate worktrees without the owner's separate agent-task utility.
// It cannot establish task completion, so the fallback leaves that unknown.
export async function readGitInventory(repo) {
  const { stdout } = await git(repo.path, ["worktree", "list", "--porcelain", "-z"]);
  const worktrees = stdout.split("\0\0").filter(Boolean).map((record, index) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find((field) => field.startsWith("branch "))?.slice(7);
    if (!path || fields.includes("bare")) throw new Error("Configure a checked-out Git repository.");
    return {
      path,
      branch: branch?.replace(/^refs\/heads\//, "") || "detached",
      primary: index === 0,
      state: "UNKNOWN",
    };
  });
  return { worktrees };
}

export async function readWorktreeInventory(repo, { run = command } = {}) {
  try {
    const result = await run("agent-task", ["status", "--repo", repo.path, "--all", "--json"], { timeout: 60_000 });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error.cause?.code !== "ENOENT") throw error;
    return readGitInventory(repo);
  }
}
