import type { RefObject } from "react";
import { projectReport } from "./reportSummary";
import { contextFor, taskName } from "./taskPresentation";
import { taskKey } from "./nextTask";
import { taskAdvice } from "./taskAdvice";
import { time } from "./format";
import type { Repo, Status, TaskContext, Worker } from "./types";

export function ProjectReport({
  status,
  repo,
  contexts,
  worker,
  refreshing,
  titleRef,
  onRefresh,
  onChoose,
  onBrowse,
}: {
  status: Status;
  repo: Repo;
  contexts: TaskContext[];
  worker?: Worker;
  refreshing: boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onRefresh: () => void;
  onChoose: (key: string) => void;
  onBrowse: () => void;
}) {
  const report = projectReport(status, repo);
  return (
    <section className="project-report" aria-labelledby="report-title">
      <div className="focus-card">
        <p className="report-kicker">Project check</p>
        <h2 id="report-title" ref={titleRef} tabIndex={-1}>
          {report.title}
        </h2>
        <p>{report.explanation}</p>
        <button
          className="button"
          aria-disabled={refreshing}
          onClick={() => {
            if (!refreshing) onRefresh();
          }}
        >
          {refreshing ? "Checking project…" : "Check project"}
        </button>
        <p className="helper report-freshness">
          Checked{" "}
          <time dateTime={status.generatedAt}>{time(status.generatedAt)}</time>.{" "}
          {!worker
            ? "Background check status is unavailable."
            : worker.error
              ? "Background checks need attention."
              : worker.enabled
                ? "Background checks are on."
                : "Background checks are off."}
        </p>
      </div>
      {report.findings.length > 0 && (
        <div className="report-findings">
          <h3>What we found</h3>
          <ul className="finding-list">
            {report.findings.map((task) => {
              const name =
                contextFor(task, contexts)?.title || taskName(task.branch);
              return (
                <li key={taskKey(task)}>
                  <button
                    onClick={() => onChoose(taskKey(task))}
                    aria-label={`Inspect ${name}`}
                  >
                    <strong>{name}</strong>
                    <span>{taskAdvice(task, false).title}</span>
                    <span className="finding-arrow" aria-hidden="true">
                      →
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {status.worktrees.some((w) => !w.primary) && (
        <button className="text-button browse-link" onClick={onBrowse}>
          See all work
        </button>
      )}
      <p className="report-limit">
        This checks how saved changes combine. Feature tests and publishing are
        not checked here.
      </p>
    </section>
  );
}
