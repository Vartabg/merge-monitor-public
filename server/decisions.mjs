export function classify(worktrees, excludedBranches = []) {
  const owners = new Map();
  for (const wt of worktrees) {
    if (
      wt.primary ||
      (wt.merged && !wt.isDirty) ||
      excludedBranches.includes(wt.branch)
    )
      continue;
    for (const file of wt.changedFiles) {
      const branches = owners.get(file) || [];
      branches.push(wt.branch);
      owners.set(file, branches);
    }
  }
  const conflicts = [...owners]
    .filter(([, branches]) => branches.length > 1)
    .map(([file, branches]) => ({ file, branches }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const result = worktrees.map((wt) => {
    const overlappingFiles = wt.changedFiles.filter(
      (file) => (owners.get(file) || []).length > 1,
    );
    let category = "working";
    let reason = "This task has work that is not ready for review yet.";
    let nextAction =
      "Ask the agent to finish its changes and check that they work.";
    if (wt.inspectionError) {
      category = "attention";
      reason = wt.inspectionError;
      nextAction =
        "Ask the agent to check this working copy, then refresh the board.";
    } else if (wt.primary) {
      category = wt.isDirty ? "attention" : "finished";
      reason = wt.isDirty
        ? "The main project copy has edits that are not saved in a commit."
        : "The main project copy has no uncommitted edits.";
      nextAction = wt.isDirty
        ? "Ask which task owns these edits before starting more work here."
        : "Ask your agent to start new work in its own working copy.";
    } else if (excludedBranches.includes(wt.branch)) {
      category = "attention";
      reason = "This task has been set aside in the project settings.";
      nextAction =
        "Leave this task paused until its owner decides to resume it.";
    } else if (wt.merged && !wt.isDirty) {
      category = "finished";
      reason = "These saved changes are already in the local main version.";
      nextAction =
        "Ask the agent to confirm completion and whether the change was deployed.";
    } else if (
      wt.preview?.outcome === "conflict" ||
      wt.state === "CONFLICT-WITH-BASE"
    ) {
      category = "attention";
      reason = "These changes conflict with the main project version.";
      nextAction =
        "Ask the agent to resolve the conflict in its own copy, then test again.";
    } else if (overlappingFiles.length) {
      category = "attention";
      reason = `${overlappingFiles.length} file${overlappingFiles.length === 1 ? "" : "s"} also changed by another task.`;
      nextAction =
        "Ask the agents to agree on how to combine their shared changes.";
    } else if (wt.state === "NEEDS-SYNC" || wt.preview?.outcome === "stale") {
      category = "attention";
      reason =
        "These results are out of date, or the task needs to catch up with other saved changes.";
      nextAction =
        "Ask the agent to bring its branch up to date, then refresh this board.";
    } else if (
      !wt.isDirty &&
      wt.state === "COMPLETE" &&
      wt.preview?.outcome === "clean"
    ) {
      category = "ready";
      reason =
        "The saved changes can combine with the main version; no shared files found.";
      nextAction =
        "Ask the agent to review and test the result before you decide to merge it.";
    } else if (wt.state === "READY-TO-PUSH") {
      reason = "Changes are saved on this Mac but have not finished syncing.";
      nextAction =
        "Ask the agent to verify its work and finish saving it to the remote project.";
    }
    return {
      ...wt,
      category,
      reason,
      nextAction,
      overlappingFiles,
      checks: "not-run",
    };
  });
  return { worktrees: result, conflicts, fileMapSize: owners.size };
}
