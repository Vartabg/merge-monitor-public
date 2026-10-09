import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

export async function repository(branch = "main") {
  const root = await mkdtemp(join(tmpdir(), "merge-monitor-test-"));
  const path = join(root, "repo");
  await mkdir(path);
  const git = (args, cwd = path) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  git(["init", "-b", branch]);
  git(["config", "user.name", "Monitor Test"]);
  git(["config", "user.email", "monitor@example.invalid"]);
  git(["config", "commit.gpgsign", "false"]);
  await writeFile(join(path, "shared.txt"), "base\n");
  git(["add", "."]);
  git(["commit", "-m", "base"]);
  git(["update-ref", `refs/remotes/origin/${branch}`, "HEAD"]);
  git([
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    `refs/remotes/origin/${branch}`,
  ]);
  const rows = [
    { path, branch, primary: true, state: "CLEAN-PRIMARY", dirty: 0 },
  ];
  const addTask = async (name, files, state = "COMPLETE", commit = true) => {
    const taskPath = join(root, name);
    git(["worktree", "add", "-b", `codex/${name}`, taskPath]);
    for (const [file, content] of Object.entries(files)) {
      await mkdir(dirname(join(taskPath, file)), { recursive: true });
      await writeFile(join(taskPath, file), content);
    }
    if (commit) {
      git(["add", "."], taskPath);
      git(["commit", "-m", name], taskPath);
    }
    rows.push({
      path: taskPath,
      branch: `codex/${name}`,
      primary: false,
      state,
      dirty: commit ? 0 : Object.keys(files).length,
    });
    return taskPath;
  };
  return {
    root,
    path,
    git,
    rows,
    addTask,
    repo: { id: "test", label: "Test repo", path, excludedBranches: [] },
    readStatus: async () => ({ worktrees: rows }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
