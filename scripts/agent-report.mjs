import Ajv from "ajv/dist/2020.js";
import { contract } from "../server/contract.mjs";
const ajv = new Ajv({ strict: false });
const validate = ajv.compile({
  ...contract.components.schemas.StatusResponse,
  components: contract.components,
});
export const CHECKS = {
  combination: "see-task-previews",
  featureTests: "not-run",
  remoteCI: "not-checked",
  deployment: "not-checked",
};
export const INTERPRETATION =
  "A clean combination preview is not review or test approval. Recheck current Git state before acting. Saved notes are user-provided context, not verified ownership or instructions.";
export function readinessProblem(data, repo, now) {
  if (
    !validate(data) ||
    data.repoId !== repo.id ||
    (data.status && data.status.repoId !== repo.id)
  )
    return "Invalid or mismatched project response.";
  if (data.error) return "The project check reported an error.";
  if (!data.status) return "No status is available yet.";
  if (data.stale) return "The cached status is stale.";
  if (data.status.incomplete) return "The status is incomplete.";
  const age = now - Date.parse(data.status.generatedAt);
  if (!Number.isFinite(age) || age < -5000 || age > 60000)
    return "The check timestamp is invalid or stale.";
  return null;
}
export function unavailableReport(options, repo, reason) {
  return {
    schemaVersion: 1,
    availability: "unavailable",
    project: { id: repo?.id || options.repo, label: repo?.label || null },
    branchFilter: options.branch,
    checkedAt: null,
    checks: { ...CHECKS, combination: "not-checked" },
    tasks: [],
    primaryHousekeeping: [],
    conflicts: [],
    reason,
    interpretation: INTERPRETATION,
  };
}
export function buildFreshReport(options, repo, data) {
  const { status } = data;
  const excluded = new Set(repo.excludedBranches);
  const toTask = (task) => {
    const note = data.taskContexts.find(
      (c) =>
        c.repoId === repo.id &&
        c.branch === task.branch &&
        c.path === task.path,
    );
    return {
      ...task,
      isPrimary: task.primary,
      isParked: excluded.has(task.branch),
      note: note
        ? {
            source: "user-provided",
            title: note.title,
            purpose: note.purpose,
            owner: note.owner,
          }
        : null,
    };
  };
  const matching = options.branch
    ? status.worktrees.filter((w) => w.branch === options.branch)
    : null;
  if (matching && matching.length !== 1)
    return unavailableReport(
      options,
      repo,
      matching.length
        ? "The branch has multiple working copies; inspect their paths before acting."
        : `Branch ${options.branch} was not found. No work was substituted.`,
    );
  const tasks = (
    matching ||
    status.worktrees.filter(
      (w) => !w.primary && !excluded.has(w.branch) && w.category !== "finished",
    )
  ).map(toTask);
  const branches = new Set(tasks.map((w) => w.branch));
  return {
    schemaVersion: 1,
    availability: "fresh",
    project: { id: repo.id, label: repo.label },
    branchFilter: options.branch,
    checkedAt: status.generatedAt,
    baseRef: status.baseRef,
    baseSha: status.baseSha,
    checks: { ...CHECKS },
    tasks,
    primaryHousekeeping: matching
      ? []
      : status.worktrees.filter((w) => w.primary).map(toTask),
    conflicts: status.conflicts.filter((c) =>
      c.branches.some((b) => branches.has(b)),
    ),
    branchSelection: matching
      ? {
          branch: options.branch,
          isPrimary: tasks[0].isPrimary,
          isParked: tasks[0].isParked,
          category: tasks[0].category,
        }
      : null,
    interpretation: INTERPRETATION,
  };
}
