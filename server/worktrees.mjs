import { git, previewMerge } from "./git.mjs";
const text = async (path, args) => (await git(path, args)).stdout.trim();

export function parseDirty(output) {
  const records = output.split("\0");
  const paths = [];
  let count = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    count++;
    paths.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2)) && records[i + 1])
      paths.push(records[++i]);
  }
  return { paths, count };
}

export async function inspectWorktree(repo, row, base) {
  const [common, expectedCommon] = await Promise.all([
    text(row.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    text(repo.path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  ]);
  if (common !== expectedCommon)
    throw new Error(
      "A reported worktree does not belong to the configured repository.",
    );
  const headSha = await text(row.path, ["rev-parse", "HEAD"]);
  const [changes, dirty, commit, merged] = await Promise.all([
    git(row.path, [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      `${base.sha}...${headSha}`,
      "--",
    ]),
    git(row.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(row.path, ["log", "-1", "--format=%h %s"]),
    git(row.path, ["merge-base", "--is-ancestor", headSha, base.sha], {
      allowedCodes: [0, 1],
    }),
  ]);
  const changedFiles = [
    ...new Set([
      ...changes.stdout.split("\0").filter(Boolean),
      ...parseDirty(dirty.stdout).paths,
    ]),
  ].sort();
  const isDirty = dirty.stdout.length > 0;
  let preview = null;
  if (
    !row.primary &&
    !isDirty &&
    merged.code !== 0 &&
    !(repo.excludedBranches || []).includes(row.branch)
  ) {
    preview = await previewMerge(repo, row.branch, {
      headSha,
      baseSha: base.sha,
    });
  }
  return {
    ...row,
    headSha,
    lastCommit: commit.stdout.trim(),
    changedFiles,
    isDirty,
    dirty: parseDirty(dirty.stdout).count,
    merged: merged.code === 0,
    preview,
  };
}
