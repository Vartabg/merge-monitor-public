import { useState } from "react";
import { useStatus } from "./useStatus";
import { time } from "./format";
import { WorkerPanel } from "./WorkerPanel";
import { ProjectCopy } from "./ProjectCopy";
import { AgentAccess } from "./AgentAccess";
import { FocusWorkspace } from "./FocusWorkspace";
import type { Repo } from "./types";

export function RepoDashboard({ repo }: { repo: Repo }) {
  const { data, error, stale, refresh, reload } = useStatus(repo.id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = data?.status;
  const unavailable = stale || Boolean(status?.incomplete) || Boolean(error);
  async function onRefresh() {
    setActionError(null);
    try {
      await refresh();
    } catch {
      setActionError(
        "The check could not start. Make sure the local service is running, then try again.",
      );
    }
  }
  return (
    <>
      {(!status || unavailable) && (
        <section className="focus-card" aria-labelledby="connection-title">
          <h2 id="connection-title">
            {error
              ? "We have lost the connection."
              : status
                ? "Let’s check again."
                : "Checking your project…"}
          </h2>
          <p role={error ? "alert" : "status"}>
            {error
              ? "Ask the person helping with your project to restart Merge Monitor. Then press Try again."
              : status?.incomplete
                ? "We could not check all the work. Press Try again before taking the next step."
                : status
                  ? "Things may have changed since the last check. Press Try again to see the next step."
                  : "The project report will appear here when the check finishes."}
          </p>
          {(error || status) && (
            <button
              className="button"
              disabled={data?.refreshing}
              onClick={onRefresh}
            >
              {data?.refreshing ? "Checking…" : "Try again"}
            </button>
          )}
        </section>
      )}
      {actionError && (
        <p className="error-box" role="alert">
          {actionError}
        </p>
      )}
      {status && (
        <div hidden={unavailable}>
          <FocusWorkspace
            status={status}
            contexts={data?.taskContexts || []}
            repo={repo}
            disabled={unavailable}
            onAction={reload}
            onRefresh={onRefresh}
            refreshing={Boolean(data?.refreshing)}
            worker={data?.worker}
          />
        </div>
      )}
      <AgentAccess repo={repo} />
      <details
        className="project-details"
        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
      >
        <summary>Check history and settings</summary>
        {detailsOpen && (
          <>
            <div className="check-information">
              <p>
                Last checked{" "}
                <time dateTime={status?.generatedAt}>
                  {time(status?.generatedAt)}
                </time>
              </p>
              <button
                className="text-button"
                onClick={onRefresh}
                disabled={data?.refreshing}
              >
                {data?.refreshing ? "Checking…" : "Check again"}
              </button>
            </div>
            {status && (
              <ProjectCopy
                status={status}
                disabled={unavailable}
                onAction={reload}
              />
            )}
            <WorkerPanel
              worker={data?.worker}
              history={data?.history || []}
              contexts={data?.taskContexts || []}
              disabled={unavailable}
              onAction={reload}
            />
          </>
        )}
      </details>
    </>
  );
}
