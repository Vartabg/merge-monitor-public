import { useEffect, useRef, useState } from "react";
import { taskKey } from "./nextTask";
import { FocusTask } from "./FocusTask";
import { TaskPicker } from "./TaskPicker";
import { ProjectReport } from "./ProjectReport";
import type { Repo, Status, TaskContext, Worker } from "./types";

export function FocusWorkspace({
  status,
  contexts,
  repo,
  disabled,
  onAction,
  onRefresh = onAction,
  refreshing = false,
  worker,
}: {
  status: Status;
  contexts: TaskContext[];
  repo: Repo;
  disabled: boolean;
  onAction: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  worker?: Worker;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"report" | "work" | "browse">("report");
  const [browseFrom, setBrowseFrom] = useState<"report" | "work">("report");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reportRef = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (view !== "browse" && moveFocus.current) {
      (view === "report" ? reportRef : titleRef).current?.focus();
      moveFocus.current = false;
    }
  }, [view, selected]);
  const task = status.worktrees.find((w) => taskKey(w) === selected);
  const tasks = status.worktrees.filter((w) => !w.primary);
  const projectContexts = contexts.filter((c) => c.repoId === repo.id);
  function choose(key: string) {
    moveFocus.current = true;
    setSelected(key);
    setView("work");
  }
  function browse() {
    setBrowseFrom(view === "work" ? "work" : "report");
    setView("browse");
  }
  function showReport() {
    moveFocus.current = true;
    setView("report");
  }
  return (
    <>
      <div hidden={view !== "report"}>
        <ProjectReport
          status={status}
          repo={repo}
          contexts={projectContexts}
          worker={worker}
          refreshing={refreshing}
          titleRef={reportRef}
          onRefresh={onRefresh}
          onChoose={choose}
          onBrowse={browse}
        />
      </div>
      <div hidden={view !== "work"}>
        {selected && (
          <>
            <button className="text-button report-back" onClick={showReport}>
              ← Back to project report
            </button>
            {task ? (
              <FocusTask
                key={taskKey(task)}
                task={task}
                status={status}
                contexts={projectContexts}
                parked={repo.excludedBranches.includes(task.branch)}
                disabled={disabled}
                titleRef={titleRef}
                onAction={onAction}
              />
            ) : (
              <section className="focus-card" aria-labelledby="focus-title">
                <h2 ref={titleRef} tabIndex={-1} id="focus-title">
                  This work is no longer listed.
                </h2>
                <p>
                  Its name or location may have changed. Return to the report
                  for current findings.
                </p>
              </section>
            )}
            <button className="text-button browse-link" onClick={browse}>
              Look at other work
            </button>
          </>
        )}
      </div>
      {view === "browse" && (
        <TaskPicker
          tasks={tasks}
          contexts={projectContexts}
          onChoose={choose}
          onBack={() => {
            moveFocus.current = true;
            setView(browseFrom);
          }}
        />
      )}
    </>
  );
}
