import { useId, useState } from "react";
import { postJson } from "./api";
import { taskName } from "./taskPresentation";
import type { TaskContext, Worktree } from "./types";

export function TaskContextEditor({
  worktree,
  repoId,
  context,
  disabled,
  onAction,
}: {
  worktree: Worktree;
  repoId: string;
  context?: TaskContext;
  disabled: boolean;
  onAction: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(context?.title || "");
  const [purpose, setPurpose] = useState(context?.purpose || "");
  const [owner, setOwner] = useState(context?.owner || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await postJson<TaskContext>("/api/task-context", {
        repoId,
        path: worktree.path,
        branch: worktree.branch,
        title,
        purpose,
        owner,
      });
      setSaved(true);
      onAction();
    } catch (failure) {
      setError(
        failure instanceof TypeError
          ? "Could not reach Merge Monitor. Reconnect to the local service, then save again."
          : failure instanceof Error
            ? failure.message
            : "Context could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="context-editor files">
      <summary>
        {context ? "Edit the name and notes" : "Add a name and notes"}
      </summary>
      <p className="help-text" id={`${id}-help`}>
        Give this work a name you recognize. These notes stay on this computer.
        Saving notes does not change the work.
      </p>
      <form onSubmit={save} aria-describedby={`${id}-help`}>
        <fieldset disabled={disabled}>
          <legend className="sr-only">Notes about this work</legend>
          <label htmlFor={`${id}-title`}>Name for this work</label>
          <input
            id={`${id}-title`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaved(false);
            }}
            readOnly={busy}
            maxLength={120}
            placeholder={taskName(worktree.branch)}
          />
          <label htmlFor={`${id}-purpose`}>
            What is this work meant to accomplish?
          </label>
          <textarea
            id={`${id}-purpose`}
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value);
              setSaved(false);
            }}
            readOnly={busy}
            maxLength={800}
            rows={3}
            placeholder="Example: Help readers find a passage without knowing its exact wording."
          />
          <label htmlFor={`${id}-owner`}>
            Name of the AI chat to return to
          </label>
          <input
            id={`${id}-owner`}
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setSaved(false);
            }}
            readOnly={busy}
            maxLength={120}
            placeholder="Example: Search improvements task in Codex"
          />
          <p className="help-text">
            Use the conversation name you can find in your AI chat app. Leave
            anything you do not know blank.
          </p>
          <button
            className="button secondary"
            type="submit"
            aria-disabled={busy}
          >
            {busy ? "Saving…" : "Save notes"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="action-message">
          Notes saved on this computer.
        </p>
      )}
    </details>
  );
}
