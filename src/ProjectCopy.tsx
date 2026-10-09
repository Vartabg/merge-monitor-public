import { BranchDetails } from "./BranchDetails";
import type { Status } from "./types";

export function ProjectCopy({
  status,
  disabled,
  onAction,
}: {
  status: Status;
  disabled: boolean;
  onAction: () => void;
}) {
  const primary = status.worktrees.find((w) => w.primary);
  if (!primary) return null;
  return (
    <details className="project-copy">
      <summary>
        <strong>Main project copy</strong>
        <span>
          {primary.inspectionError
            ? "Could not check"
            : primary.isDirty
              ? `${primary.dirty} ${primary.dirty === 1 ? "file" : "files"} with uncommitted edits`
              : "No uncommitted edits"}
        </span>
      </summary>
      <p className="help-text">
        This is the shared working copy of {status.label}. It is shown
        separately because it is not an agent task. Uncommitted edits are normal
        during work; identify their owner before starting more work here.
      </p>
      <BranchDetails
        worktree={primary}
        status={status}
        disabled={disabled}
        onAction={onAction}
      />
    </details>
  );
}
