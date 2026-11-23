import { useState } from "react";
import { formatDate } from "./boardHelpers";
import type { Member } from "./boardHelpers";

export function BoardMembers({
  helpers,
  stale,
  staleAfterHours,
  disabled,
  onPrune,
}: {
  helpers: Member[];
  stale: Set<string>;
  staleAfterHours: number;
  disabled: boolean;
  onPrune: (includeStale: boolean) => Promise<boolean>;
}) {
  const [includeStale, setIncludeStale] = useState(false);
  const doneCount = helpers.filter((m) => m.state === "done").length;
  const canClear = doneCount > 0 || (includeStale && stale.size > 0);
  return (
    <details className="board-details">
      <summary>
        Agent check-ins · {helpers.length} helpers
        {stale.size ? ` · ${stale.size} stale` : ""}
      </summary>
      <p className="board-byline">
        Check-ins are updates from agents, not proof that they are still
        running. Names are supplied by local clients. Stale means no check-in
        for {staleAfterHours} hours.
      </p>
      {(doneCount > 0 || stale.size > 0) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canClear) return;
            if (await onPrune(includeStale)) setIncludeStale(false);
          }}
        >
          <p className="board-byline">
            Clears finished check-ins that have no open requests. Active
            assignment participants and all messages are always kept.
          </p>
          {stale.size > 0 && (
            <label className="board-check">
              <input
                type="checkbox"
                checked={includeStale}
                onChange={(e) => setIncludeStale(e.target.checked)}
              />
              Also clear stale check-ins
            </label>
          )}
          <button
            type="submit"
            className="button secondary"
            disabled={disabled || !canClear}
          >
            {includeStale
              ? "Clear finished and stale check-ins"
              : "Clear finished check-ins"}
          </button>
        </form>
      )}
      <ul className="board-members">
        {helpers.map((m) => (
          <li key={m.agent}>
            <h3>{m.agent}</h3>
            <p>{m.task}</p>
            <p className="board-byline">
              {m.state} · checked in {formatDate(m.checkedInAt)}
              {stale.has(m.agent) ? " · stale, may have stopped" : ""}
            </p>
            {m.scope && <p>Scope: {m.scope}</p>}
            <p className="board-byline">
              {m.lastReadAt
                ? `Last read ${formatDate(m.lastReadAt)} · through message ${m.lastReadSequence}`
                : "No recorded board read yet"}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
