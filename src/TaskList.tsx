import { categories } from "./format";
import { BranchDetails } from "./BranchDetails";
import { contextFor, lastSavedChange, taskName } from "./taskPresentation";
import type { Category, Status, TaskContext } from "./types";

type Props = {
  status: Status;
  filter: Category | "all";
  query: string;
  contexts: TaskContext[];
  disabled: boolean;
  onAction: () => void;
};
export function TaskList({
  status,
  filter,
  query,
  contexts,
  disabled,
  onAction,
}: Props) {
  const needle = query.trim().toLowerCase();
  const projectContexts = contexts.filter((c) => c.repoId === status.repoId);
  const contextByTask = new Map(
    status.worktrees.map((w) => [w, contextFor(w, projectContexts)]),
  );
  const worktrees = status.worktrees.filter(
    (w) =>
      !w.primary &&
      (filter === "all" || w.category === filter) &&
      (!needle ||
        [
          w.branch,
          w.lastCommit,
          contextByTask.get(w)?.title || "",
          contextByTask.get(w)?.purpose || "",
          contextByTask.get(w)?.owner || "",
          ...w.changedFiles,
        ].some((value) => value.toLowerCase().includes(needle))),
  );
  if (!worktrees.length)
    return (
      <div className="empty" role="status">
        <h3>
          {status.worktrees.some((w) => !w.primary)
            ? "No tasks in this view"
            : "No separate tasks found yet"}
        </h3>
        <p>
          {status.worktrees.some((w) => !w.primary)
            ? "Try another stage or clear your search and filters."
            : "Ask your coding agent to start work in an isolated task worktree for this project. Refresh this board once it exists."}
        </p>
      </div>
    );
  return (
    <div className="task-groups">
      <p className="sr-only" role="status">
        {worktrees.length} {worktrees.length === 1 ? "task" : "tasks"} in this
        view.
      </p>
      {categories.map((category) => {
        const group = worktrees.filter((w) => w.category === category.id);
        if (!group.length) return null;
        const content = (
          <div className="task-list">
            {group.map((w) => (
              <details
                className={`task ${w.category}`}
                key={`${w.path}:${w.branch}`}
              >
                <summary>
                  <span className="task-symbol" aria-hidden="true">
                    {w.category === "attention"
                      ? "!"
                      : w.category === "ready"
                        ? "↗"
                        : w.category === "finished"
                          ? "✓"
                          : "·"}
                  </span>
                  <span className="task-main">
                    <span className="task-title">
                      <span className="human-title">
                        {contextByTask.get(w)?.title || taskName(w.branch)}
                      </span>
                      {!contextByTask.get(w)?.title && (
                        <span className="tag">Name from branch</span>
                      )}
                    </span>
                    <span className="task-purpose">
                      {contextByTask.get(w)?.purpose ||
                        `Latest saved change: ${lastSavedChange(w)}`}
                    </span>
                    <span className="task-reason">{w.reason}</span>
                    <span className="task-next">
                      <strong>Next:</strong> {w.nextAction}
                    </span>
                    <span className="task-meta">
                      {contextByTask.get(w)?.owner || "Owner not recorded"} ·{" "}
                      {w.changedFiles.length}{" "}
                      {w.changedFiles.length === 1
                        ? "file changed"
                        : "files changed"}
                    </span>
                  </span>
                  <span className="expand-icon" aria-hidden="true">
                    +
                  </span>
                </summary>
                <BranchDetails
                  worktree={w}
                  status={status}
                  context={contextByTask.get(w)}
                  disabled={disabled}
                  onAction={onAction}
                />
              </details>
            ))}
          </div>
        );
        return category.id === "finished" && filter === "all" && !needle ? (
          <details key={category.id} className="finished-group">
            <summary>
              {category.label} <span>{group.length}</span>
            </summary>
            {content}
          </details>
        ) : (
          <section
            key={category.id}
            className="task-group"
            aria-label={category.label}
          >
            <h3 className="group-heading">
              {category.label}
              <span>{group.length}</span>
            </h3>
            {content}
          </section>
        );
      })}
    </div>
  );
}
