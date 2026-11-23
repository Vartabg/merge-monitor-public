import {
  findingRows,
  formatDate,
  isFyi,
  labels,
  person,
  requestKinds,
} from "./boardHelpers";
import type { Message } from "./boardHelpers";

export function BoardMessageCard({
  message: m,
  messages,
  disabled,
  composing,
  onReply,
  onAck,
  onResolve,
}: {
  message: Message;
  messages: Message[];
  disabled: boolean;
  composing: boolean;
  onReply: (message: Message, trigger: HTMLButtonElement) => void;
  onAck: (messageId: string) => void;
  onResolve: (messageId: string) => void;
}) {
  const original = m.replyTo && messages.find((item) => item.id === m.replyTo);
  const repliedByYou = messages.some(
    (item) => item.replyTo === m.id && item.agent === "human",
  );
  const canResolve =
    m.agent === "human" ||
    (m.to === "human" && (!requestKinds.includes(m.kind) || repliedByYou));
  const finding = m.finding;
  return (
    <li className="board-message">
      <div className="board-message-meta">
        <strong>
          {labels[m.kind]}
          {m.to && isFyi(m) ? " · FYI" : ""}
        </strong>
        <time dateTime={m.at}>{formatDate(m.at)}</time>
      </div>
      <p className="board-byline">
        {person(m.agent)} → {m.to ? person(m.to) : "Everyone on this project"}
      </p>
      {original && (
        <p className="board-reply-context">
          Reply to {person(original.agent)}: {original.text.slice(0, 160)}
          {original.text.length > 160 ? "…" : ""}
        </p>
      )}
      <p className="board-body">
        {m.text.length > 360 ? `${m.text.slice(0, 320).trimEnd()}…` : m.text}
      </p>
      {m.text.length > 360 && (
        <details className="board-message-details">
          <summary>
            Read full message<span className="sr-only"> {m.sequence}</span>
          </summary>
          <p className="board-body">{m.text}</p>
        </details>
      )}
      {finding && (
        <dl className="board-finding">
          <div>
            <dt>Severity</dt>
            <dd>
              <span
                className={`board-severity board-severity-${finding.severity}`}
              >
                {finding.severity === "blocking" ? "Blocking" : "Non-blocking"}
              </span>
            </dd>
          </div>
          {findingRows
            .filter(([key]) => finding[key])
            .map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{finding[key]}</dd>
              </div>
            ))}
        </dl>
      )}
      <p className="board-status">
        {m.resolvedAt
          ? `Resolved by ${person(m.resolvedBy)} · ${formatDate(m.resolvedAt)}${m.resolutionNote ? ` · ${m.resolutionNote}` : ""}`
          : m.acknowledgedAt
            ? `Acknowledged ${formatDate(m.acknowledgedAt)} · still open`
            : m.to
              ? "Awaiting acknowledgment"
              : "Shared with the project"}
      </p>
      {!m.resolvedAt && (
        <div className="board-actions">
          <button
            type="button"
            className="button secondary"
            disabled={disabled || composing}
            onClick={(event) => onReply(m, event.currentTarget)}
          >
            Reply
            <span className="sr-only">
              {" "}
              to {person(m.agent)} message {m.sequence}
            </span>
          </button>
          {m.to === "human" && !m.acknowledgedAt && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => onAck(m.id)}
            >
              Acknowledge
              <span className="sr-only"> message {m.sequence}</span>
            </button>
          )}
          {canResolve ? (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => onResolve(m.id)}
            >
              Mark resolved
              <span className="sr-only"> message {m.sequence}</span>
            </button>
          ) : (
            m.to === "human" && (
              <p className="board-status board-resolve-hint">
                Reply with the outcome to resolve.
              </p>
            )
          )}
        </div>
      )}
    </li>
  );
}
