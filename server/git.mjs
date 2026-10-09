import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export async function command(
  file,
  args,
  { timeout = 15_000, allowedCodes = [0] } = {},
) {
  try {
    const result = await execute(file, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return { ...result, code: 0 };
  } catch (error) {
    if (allowedCodes.includes(error.code) && !error.killed)
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    throw new Error(
      error.killed
        ? `${file} inspection timed out. Try again after other Git tasks finish.`
        : `${file} inspection failed. Check that the repository and required command are available.`,
      { cause: error },
    );
  }
}
export const git = (path, args, options) =>
  command("git", ["--no-optional-locks", "-C", path, ...args], options);
const text = async (path, args) => (await git(path, args)).stdout.trim();

export async function resolveBase(repo) {
  let branch = repo.defaultBranch;
  if (!branch) {
    const symbolic = await git(
      repo.path,
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      { allowedCodes: [0, 1] },
    );
    if (symbolic.code === 0)
      branch = symbolic.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
  }
  if (!branch) {
    const candidates = [];
    for (const name of ["main", "master"]) {
      const result = await git(
        repo.path,
        ["show-ref", "--verify", "--quiet", `refs/heads/${name}`],
        { allowedCodes: [0, 1] },
      );
      if (result.code === 0) candidates.push(name);
    }
    if (candidates.length !== 1)
      throw new Error(
        "Default branch is ambiguous. Set defaultBranch in monitor.config.json.",
      );
    branch = candidates[0];
  }
  await validateBranch(repo.path, branch);
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const result = await git(
      repo.path,
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { allowedCodes: [0, 1] },
    );
    if (result.code === 0) return { ref, sha: result.stdout.trim(), branch };
  }
  throw new Error(
    "Default branch is unavailable. Fetch the repository or correct defaultBranch in monitor.config.json.",
  );
}

export async function validateBranch(path, branch) {
  if (
    typeof branch !== "string" ||
    branch.startsWith("-") ||
    branch.length > 240 ||
    /[\s;`$|&<>]/.test(branch)
  ) {
    throw new Error("Choose an existing task branch from this repository.");
  }
  await git(path, ["check-ref-format", "--branch", branch]);
}

export async function branchSha(repo, branch) {
  await validateBranch(repo.path, branch);
  return text(repo.path, [
    "rev-parse",
    "--verify",
    `refs/heads/${branch}^{commit}`,
  ]);
}

export async function previewMerge(repo, branch, expected = {}) {
  const base = await resolveBase(repo);
  const headSha = await branchSha(repo, branch);
  const common = {
    branch,
    headSha,
    baseSha: base.sha,
    baseRef: base.ref,
    checkedAt: new Date().toISOString(),
    files: [],
  };
  if (
    (expected.headSha && expected.headSha !== headSha) ||
    (expected.baseSha && expected.baseSha !== base.sha)
  ) {
    return {
      ...common,
      outcome: "stale",
      message: "The branch or base changed. Refresh before previewing again.",
    };
  }
  const result = await git(
    repo.path,
    ["merge-tree", "--write-tree", "--name-only", base.sha, headSha],
    { allowedCodes: [0, 1], timeout: 30_000 },
  );
  const [currentHead, currentBase] = await Promise.all([
    branchSha(repo, branch),
    resolveBase(repo),
  ]);
  if (currentHead !== headSha || currentBase.sha !== base.sha) {
    return {
      ...common,
      outcome: "stale",
      message:
        "The branch or base changed during the preview. Refresh and try again.",
    };
  }
  const files =
    result.code === 1
      ? result.stdout
          .split("\n")
          .slice(1)
          .join("\n")
          .split("\n\n")[0]
          .split("\n")
          .filter(Boolean)
      : [];
  return {
    ...common,
    files,
    outcome: result.code === 0 ? "clean" : "conflict",
    message:
      result.code === 0
        ? "Git can combine these commits. Tests and review are still required."
        : "Git found merge conflicts with the base. Resolve them in the task worktree.",
  };
}
