import type { Repo, Status } from "./types";

export function projectReport(status: Status, repo: Repo) {
  const tasks = status.worktrees.filter(
    (w) =>
      !w.primary &&
      !repo.excludedBranches.includes(w.branch) &&
      w.category !== "finished",
  );
  const attention = tasks.filter((w) => w.category === "attention");
  const ready = tasks.filter((w) => w.category === "ready");
  const working = tasks.filter((w) => w.category === "working");
  const number = (count: number) =>
    `${count} ${count === 1 ? "piece" : "pieces"} of work`;
  return {
    attention,
    ready,
    working,
    findings: [...attention, ...ready, ...working].slice(0, 3),
    title: attention.length
      ? "Some changes need coordination."
      : ready.length
        ? "Saved changes are ready for review."
        : working.length
          ? "Work has not reached review yet."
          : "No unfinished work to check.",
    explanation: attention.length
      ? `${number(attention.length)} should be checked before being combined. Open a finding below to see why.`
      : ready.length
        ? `${number(ready.length)} passed the combination check. Review and tests are still needed before you decide to use the changes.`
        : working.length
          ? `${number(working.length)} still need to be finished or checked. This report updates as the saved work changes.`
          : "There is no active, unfinished work listed for this project. Work on hold and the main project copy are available in the details.",
  };
}
