import { useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { labels, person, requestKinds } from "./boardHelpers";
import type { Member, Message } from "./boardHelpers";

export function BoardComposer({
  members,
  kind,
  to,
  attention,
  text,
  replyTo,
  prunedSender,
  disabled,
  onChangeKind,
  onChangeTo,
  onChangeAttention,
  onChangeText,
  onSubmit,
  onCancel,
}: {
  members: Member[];
  kind: Message["kind"];
  to: string;
  attention: "action" | "fyi";
  text: string;
  replyTo: string;
  prunedSender: string;
  disabled: boolean;
  onChangeKind: (kind: Message["kind"]) => void;
  onChangeTo: (to: string) => void;
  onChangeAttention: (attention: "action" | "fyi") => void;
  onChangeText: (text: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [replyTo]);
  return (
    <form className="board-compose" onSubmit={onSubmit}>
      {prunedSender && (
        <p className="board-byline">
          {prunedSender} is no longer checked in. Your reply will post to
          everyone on this project so you can still resolve the request.
        </p>
      )}
      <label htmlFor="board-message">
        {replyTo ? "Your reply" : "What does the team need to know?"}
      </label>
      <textarea
        id="board-message"
        ref={inputRef}
        value={text}
        required
        maxLength={4000}
        onChange={(e) => onChangeText(e.target.value)}
      />
      <div className="board-form-row">
        <label>
          Message type
          <select
            value={kind}
            onChange={(e) => onChangeKind(e.target.value as Message["kind"])}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Send to
          <select
            value={to}
            required={requestKinds.includes(kind)}
            onChange={(e) => onChangeTo(e.target.value)}
          >
            <option value="">Everyone on this project</option>
            {!members.some((m) => m.agent === "human") && (
              <option value="human">You</option>
            )}
            {members.map((m) => (
              <option key={m.agent} value={m.agent}>
                {person(m.agent)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === "handoff" && (
        <label>
          Response expected
          <select
            value={attention}
            onChange={(e) =>
              onChangeAttention(e.target.value as "action" | "fyi")
            }
          >
            <option value="action">Action needed</option>
            <option value="fyi">FYI — finished report</option>
          </select>
        </label>
      )}
      <div className="board-actions">
        <button type="submit" className="button" disabled={disabled}>
          Send to board
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
  );
}
