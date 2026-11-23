import { useEffect, useRef } from "react";
import { formatDate, person } from "./boardHelpers";
import type { Report } from "./boardHelpers";

export interface GoalDraft {
  text: string;
  revision: number;
}

export function BoardGoal({
  room,
  goalEdit,
  disabled,
  goalButtonRef,
  onStartEdit,
  onChangeDraft,
  onAdoptRevision,
  onSave,
  onCancel,
}: {
  room: Report["room"];
  goalEdit?: GoalDraft;
  disabled: boolean;
  goalButtonRef: React.RefObject<HTMLButtonElement | null>;
  onStartEdit: () => void;
  onChangeDraft: (text: string) => void;
  onAdoptRevision: (revision: number) => void;
  onSave: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editing = Boolean(goalEdit);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const hasConflict = Boolean(goalEdit && room.revision !== goalEdit.revision);
  return (
    <section className="board-goal" aria-labelledby="goal-heading">
      <div className="board-section-head">
        <h2 id="goal-heading">Our shared goal</h2>
        <button
          type="button"
          className="button secondary"
          ref={goalButtonRef}
          disabled={disabled || editing}
          onClick={onStartEdit}
        >
          {room.goal ? "Edit goal" : "Set a goal"}
        </button>
      </div>
      {goalEdit ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave()) onCancel();
          }}
        >
          {hasConflict && (
            <div className="error-box" role="alert">
              <p>
                The shared goal changed while you were editing (saved by{" "}
                {person(room.goalBy)}): {room.goal}
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() => onAdoptRevision(room.revision)}
              >
                Keep my draft on latest version
              </button>
            </div>
          )}
          <label htmlFor="shared-goal">
            What should this team accomplish?
          </label>
          <textarea
            id="shared-goal"
            ref={inputRef}
            required
            maxLength={1200}
            value={goalEdit.text}
            onChange={(e) => onChangeDraft(e.target.value)}
          />
          <div className="board-actions">
            <button type="submit" className="button" disabled={disabled}>
              Save goal
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="board-goal-text">
          {room.goal || "Give your helpers one clear outcome to work toward."}
        </p>
      )}
      {room.goal && (
        <p className="board-byline">
          Updated by {person(room.goalBy)} · {formatDate(room.goalAt)}
        </p>
      )}
    </section>
  );
}
