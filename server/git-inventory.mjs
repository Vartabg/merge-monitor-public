import { command, git } from "./git.mjs";

// Git can enumerate worktrees without the owner's separate agent-task utility.
// It cannot establish task completion, so the fallback leaves that unknown.
// Records whose folder is gone ("prunable") are reported as housekeeping, not
// inspected; the monitor never prunes them itself.
export async function readGitInventory(repo) {
  const { stdout } = await git(repo.path, ["worktree", "list", "--porcelain", "-z"]);
  const worktrees = [];
  const housekeeping = [];
  stdout.split("\0\0").filter(Boolean).forEach((record, index) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find((field) => field.startsWith("branch "))?.slice(7);
    if (!path || fields.includes("bare")) throw new Error("Configure a checked-out Git repository.");
    if (index > 0 && fields.some((field) => field === "prunable" || field.startsWith("prunable "))) {
      housekeeping.push({
        kind: "stale-worktree",
        path,
        message: `Stale worktree record at ${path} — run \`git worktree prune\` in ${repo.path}.`,
      });
      return;
    }
    worktrees.push({
      path,
      branch: branch?.replace(/^refs\/heads\//, "") || "detached",
      primary: index === 0,
      state: "UNKNOWN",
    });
  });
  return { worktrees, housekeeping };
}

export async function readWorktreeInventory(repo, { run = command } = {}) {
  let result;
  try {
    result = await run("agent-task", ["status", "--repo", repo.path, "--all", "--json"], { timeout: 60_000 });
    const inventory = JSON.parse(result.stdout);
    // agent-task may tolerate a stale record; Git still flags it. Its folder is
    // gone, so report it as housekeeping rather than as an uninspectable task.
    const { housekeeping } = await readGitInventory(repo);
    if (!housekeeping.length || !Array.isArray(inventory?.worktrees)) return { ...inventory, housekeeping };
    const stale = new Set(housekeeping.map((item) => item.path));
    return { ...inventory, worktrees: inventory.worktrees.filter((row) => !stale.has(row?.path)), housekeeping };
  } catch (error) {
    if (result) throw error;
    if (error.cause?.code === "ENOENT") return readGitInventory(repo);
    // agent-task ran and refused (for example over a stale worktree record).
    // Git can still list the worktrees; report the refusal instead of hiding it.
    if (!Number.isInteger(error.cause?.code) || error.cause?.killed) throw error;
    try {
      const inventory = await readGitInventory(repo);
      return {
        ...inventory,
        degraded: `${error.message} Showing Git-only worktree data; task completion is unknown.`,
      };
    } catch (fallback) {
      throw new Error(`${error.message} Git fallback also failed: ${fallback.message}`, { cause: fallback });
    }
  }
}
