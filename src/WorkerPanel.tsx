import { useState } from "react";
import { postJson } from "./api";
import { time } from "./format";
import { taskName } from "./taskPresentation";
import type { HistoryEvent, TaskContext, Worker } from "./types";

export function WorkerPanel({
  worker,
  history,
  disabled,
  onAction,
  contexts,
}: {
  worker?: Worker;
  history: HistoryEvent[];
  disabled: boolean;
  onAction: () => void;
  contexts: TaskContext[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/worker", { enabled: !worker?.enabled });
      onAction();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The worker could not be updated. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const label = !worker
    ? "Connecting"
    : disabled
      ? "Status unavailable"
      : worker.status === "running"
        ? "Previewing"
        : worker.status === "idle"
          ? "Watching"
          : worker.status === "error"
            ? "Needs attention"
            : "Paused";
  return (
    <>
      <section className="worker-panel" aria-labelledby="worker-title">
        <div className="section-heading">
          <h2 id="worker-title">Automatic merge checks</h2>
          <span
            className={`worker-state ${worker?.enabled && !disabled ? "enabled" : ""}`}
          >
            {label}
          </span>
        </div>
        <p>
          Keep checking saved changes across all your projects in the
          background. This only previews how code combines; your agent handles
          review and shipping.
        </p>
        <button
          className={`button ${worker?.enabled ? "secondary" : ""}`}
          disabled={disabled || busy || !worker}
          onClick={toggle}
        >
          {busy
            ? "Updating…"
            : worker?.enabled
              ? "Pause automatic checks"
              : "Enable automatic checks"}
        </button>
        <dl className="worker-meta">
          <div>
            <dt>Service last seen</dt>
            <dd>{time(worker?.heartbeat)}</dd>
          </div>
          <div>
            <dt>Last check finished</dt>
            <dd>{time(worker?.lastRun)}</dd>
          </div>
        </dl>
        {(error || worker?.error) && (
          <p className="inline-error" role="alert">
            {error || worker?.error}
          </p>
        )}
      </section>
      <section className="activity-panel" aria-labelledby="activity-title">
        <div className="section-heading">
          <h2 id="activity-title">Recent check results</h2>
          <span>Latest {history.length}</span>
        </div>
        {history.length ? (
          <ol className="timeline">
            {history.map((event) => (
              <li key={event.id}>
                <span
                  className={`event-dot ${event.outcome}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>
                    {event.branch
                      ? contexts.find(
                          (c) =>
                            c.repoId === event.repoId &&
                            c.branch === event.branch,
                        )?.title || taskName(event.branch)
                      : "Automatic checks"}
                  </strong>
                  <p>{event.message}</p>
                  <time dateTime={event.at}>{time(event.at)}</time>
                  {event.headSha && (
                    <span className="event-sha">
                      {" "}
                      · {event.headSha.slice(0, 8)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="activity-empty">
            <span aria-hidden="true">↳</span>
            <p>No previews recorded yet.</p>
            <small>
              Enable automatic checks to record results as work changes.
            </small>
          </div>
        )}
      </section>
    </>
  );
}
