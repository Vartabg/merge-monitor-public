import { useState } from "react";
import { postJson } from "./api";
import { shortRef, time } from "./format";
import type { Preview, Status, TaskContext, Worktree } from "./types";
import { lastSavedChange } from "./taskPresentation";
import { AgentRequest } from "./AgentRequest";
import { TaskContextEditor } from "./TaskContextEditor";

export function BranchDetails({
  worktree: w,
  status,
  disabled,
  onAction,
  context,
  showHandoff = true,
}: {
  worktree: Worktree;
  status: Status;
  disabled: boolean;
  onAction: () => void;
  context?: TaskContext;
  showHandoff?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function preview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await postJson<Preview>("/api/preview", {
        repoId: status.repoId,
        branch: w.branch,
        headSha: w.headSha,
        baseSha: status.baseSha,
      });
      setMessage(result.message);
      onAction();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The preview failed. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="branch-details">
      {showHandoff && (
        <>
          <div className="next-action">
            <span className="eyebrow">NEXT ACTION</span>
            <p>{w.nextAction}</p>
          </div>
          <AgentRequest
            worktree={w}
            status={status}
            context={context}
            disabled={disabled}
          />
        </>
      )}
      {!w.primary && (
        <TaskContextEditor
          worktree={w}
          repoId={status.repoId}
          context={context}
          disabled={disabled}
          onAction={onAction}
        />
      )}
      <details className="files technical-details">
        <summary>Code details and merge evidence</summary>
        <p className="help-text">
          <strong>Latest saved change:</strong> {lastSavedChange(w)}
        </p>
        <dl className="evidence">
          <div>
            <dt>Branch</dt>
            <dd>
              <code>{w.branch}</code>
            </dd>
          </div>
          <div>
            <dt>Merge preview</dt>
            <dd>
              {w.preview
                ? `${w.preview.outcome === "clean" ? "Passed" : w.preview.outcome === "conflict" ? "Conflicts found" : "Outdated"} · ${time(w.preview.checkedAt)}`
                : "Not available"}
            </dd>
          </div>
          <div>
            <dt>Project checks</dt>
            <dd>Not run by this monitor</dd>
          </div>
          <div>
            <dt>Compared commits</dt>
            <dd>
              <code>
                {w.headSha.slice(0, 8) || "Unknown"} →{" "}
                {shortRef(status.baseRef)} @ {status.baseSha.slice(0, 8)}
              </code>
            </dd>
          </div>
          <div>
            <dt>Last commit</dt>
            <dd>{w.lastCommit || "Unavailable"}</dd>
          </div>
          <div>
            <dt>Working copy</dt>
            <dd className="path">{w.path}</dd>
          </div>
        </dl>
        {w.overlappingFiles.length > 0 && (
          <div className="overlap">
            <strong>Shared with active tasks</strong>
            <ul>
              {w.overlappingFiles.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                  <span>
                    {status.conflicts
                      .find((c) => c.file === file)
                      ?.branches.filter((b) => b !== w.branch)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {w.changedFiles.length > 0 && (
          <details className="files">
            <summary>
              Changed files <span>{w.changedFiles.length}</span>
            </summary>
            <ul>
              {w.changedFiles.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
        {!w.primary && w.category !== "finished" && (
          <button
            className="button secondary"
            disabled={
              disabled ||
              busy ||
              w.isDirty ||
              Boolean(w.inspectionError) ||
              !w.preview
            }
            onClick={preview}
          >
            {busy ? "Previewing…" : "Preview merge"}
          </button>
        )}
        {message && (
          <p className="action-message" role="status">
            {message}
          </p>
        )}
      </details>
    </div>
  );
}
