import { useEffect, useRef, useState } from "react";
import { AssignmentProgress } from "./AssignmentProgress";
import { progressLabels } from "./assignmentTypes";
import type { Assignment } from "./assignmentTypes";

export function AssignmentDetail({
  assignment: item,
  onSave,
  onClose,
  disabled,
}: {
  assignment: Assignment;
  onSave: (value: Assignment) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <section className="team-panel" aria-labelledby="assignment-title">
      <button className="text-button" onClick={onClose} disabled={saving}>
        Back to assignments
      </button>
      <p className="team-progress">
        {progressLabels[item.status]} · {item.project}
      </p>
      <h2 id="assignment-title" ref={title} tabIndex={-1}>
        {item.title}
      </h2>
      <p>{item.purpose}</p>
      <dl className="team-facts">
        <div>
          <dt>Assigned to</dt>
          <dd>{item.owner}</dd>
        </div>
        <div>
          <dt>Reviewer</dt>
          <dd>{item.reviewer}</dd>
        </div>
        <div>
          <dt>Model or tool</dt>
          <dd>{item.model}</dd>
        </div>
        <div>
          <dt>Time or usage limit</dt>
          <dd>{item.budget}</dd>
        </div>
      </dl>
      <h3>What counts as finished</h3>
      <p className="team-prewrap">{item.acceptance}</p>
      <details>
        <summary>Allowed work and recorded history</summary>
        <p className="team-prewrap">{item.scope}</p>
        <ol className="team-history">
          {item.history.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <time dateTime={event.at}>
                {new Date(event.at).toLocaleString()}
              </time>
              <p>
                <strong>{progressLabels[event.status]}:</strong> {event.summary}
              </p>
            </li>
          ))}
        </ol>
      </details>
      {item.summary && (
        <>
          <h3>Latest result</h3>
          <p className="team-prewrap">{item.summary}</p>
        </>
      )}
      {item.artifacts.length > 0 && (
        <>
          <h3>Evidence</h3>
          <ul>
            {item.artifacts.map((link, index) => (
              <li key={link}>
                {/^https?:\/\//.test(link) ? (
                  <a href={link} target="_blank" rel="noreferrer">
                    Evidence {index + 1}: {link}
                  </a>
                ) : (
                  <code>{link}</code>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {item.reviewNote && (
        <>
          <h3>Review by {item.reviewer}</h3>
          <p className="team-prewrap">{item.reviewNote}</p>
        </>
      )}
      {item.status !== "accepted" && (
        <AssignmentProgress
          item={item}
          onSave={onSave}
          onBusy={setSaving}
          disabled={disabled}
        />
      )}
    </section>
  );
}
