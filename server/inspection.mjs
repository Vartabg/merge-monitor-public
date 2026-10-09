import { inspectWorktree } from "./worktrees.mjs";
import { resolveBase } from "./git.mjs";
import { classify } from "./decisions.mjs";
import { readWorktreeInventory } from "./git-inventory.mjs";

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

export async function inspectRepository(
  repo,
  { readStatus = readWorktreeInventory } = {},
) {
  const started = performance.now();
  const [base, raw] = await Promise.all([resolveBase(repo), readStatus(repo)]);
  if (!raw || !Array.isArray(raw.worktrees) || !raw.worktrees.length)
    throw new Error(
      "No valid worktree inventory was returned. Check agent-task and refresh.",
    );
  const rows = raw.worktrees.map((row) => {
    if (
      !row ||
      typeof row.path !== "string" ||
      typeof row.branch !== "string" ||
      typeof row.primary !== "boolean" ||
      typeof row.state !== "string"
    ) {
      throw new Error(
        "The worktree inventory has an unsupported format. Update agent-task and refresh.",
      );
    }
    return {
      path: row.path,
      branch: row.branch,
      primary: row.primary,
      state: row.state,
      dirty: Number.isFinite(row.dirty) ? row.dirty : 0,
      ahead: row.ahead || 0,
      behind: row.behind || 0,
      upstream: row.upstream || null,
    };
  });
  const worktrees = await mapLimit(rows, 3, async (row) => {
    try {
      return await inspectWorktree(repo, row, base);
    } catch (error) {
      return {
        ...row,
        headSha: "",
        lastCommit: "",
        changedFiles: [],
        isDirty: row.dirty > 0,
        merged: false,
        preview: null,
        inspectionError: error.message,
      };
    }
  });
  const decisions = classify(worktrees, repo.excludedBranches);
  // An unreadable worktree might own any file. Never declare another task ready in that case.
  const incomplete = decisions.worktrees.some((w) => w.inspectionError);
  if (incomplete)
    for (const wt of decisions.worktrees)
      if (wt.category === "ready") {
        wt.category = "attention";
        wt.reason = "Another worktree could not be inspected.";
        wt.nextAction =
          "Restore complete repository visibility before merging.";
      }
  return {
    repoId: repo.id,
    label: repo.label,
    baseRef: base.ref,
    baseSha: base.sha,
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    incomplete,
    ...decisions,
  };
}
