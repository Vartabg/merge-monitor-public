import type { Status, TaskContext, Worktree } from "./types";

export function taskName(branch: string) {
  const words = branch
    .replace(/^(codex|claude|agent|feature|fix)\//i, "")
    .replace(/[-_/]+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Unnamed task";
}
export const lastSavedChange = (w: Worktree) =>
  w.lastCommit.replace(/^[a-f0-9]{7,40}\s+/, "") ||
  "No commit information available.";
export const contextFor = (w: Worktree, contexts: TaskContext[]) =>
  contexts.find((c) => c.path === w.path && c.branch === w.branch);

export function requestLabel(w: Worktree) {
  if (w.primary) return "Copy housekeeping request";
  if (w.category === "ready") return "Copy review request";
  if (w.category === "finished") return "Copy follow-up request";
  if (w.overlappingFiles.length) return "Copy coordination request";
  return "Copy next-step request";
}

export function agentRequest(
  w: Worktree,
  status: Status,
  context?: TaskContext,
) {
  return [
    `Please check ${w.primary ? "the main project copy" : `the task “${context?.title || taskName(w.branch)}”`} in ${status.label}.`,
    context?.purpose ? `Purpose: ${context.purpose}` : "",
    context?.owner ? `Responsible task / agent: ${context.owner}` : "",
    `Working copy: ${w.path}`,
    `Branch: ${w.branch}`,
    `Merge Monitor observed at ${status.generatedAt}: ${w.reason}`,
    `Next step: ${w.nextAction}`,
    w.overlappingFiles.length
      ? `Shared files: ${w.overlappingFiles.join(", ")}`
      : "",
    w.overlappingFiles.length
      ? `Other branches to coordinate with: ${[
          ...new Set(
            status.conflicts
              .filter((c) => w.overlappingFiles.includes(c.file))
              .flatMap((c) => c.branches)
              .filter((b) => b !== w.branch),
          ),
        ].join(", ")}`
      : "",
    `Recheck current state before acting. The monitor compared local ${status.baseRef} at ${status.baseSha.slice(0, 8)} with ${w.headSha.slice(0, 8)}.`,
    "Review and test the changes before any merge. The monitor has not checked feature quality, CI results, or deployment. Explain the result and any decision you need from me.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
