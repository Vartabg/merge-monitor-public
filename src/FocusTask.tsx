import { useState, type RefObject } from "react";
import { taskAdvice } from "./taskAdvice";
import { AgentRequest } from "./AgentRequest";
import { BranchDetails } from "./BranchDetails";
import { contextFor, taskName } from "./taskPresentation";
import type { Status, TaskContext, Worktree } from "./types";

export function FocusTask({
  task,
  status,
  contexts,
  disabled,
  parked,
  titleRef,
  onAction,
}: {
  task: Worktree;
  status: Status;
  contexts: TaskContext[];
  disabled: boolean;
  parked: boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onAction: () => void;
}) {
  const [handedOff, setHandedOff] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const context = contextFor(task, contexts);
  const finished = task.category === "finished";
  const advice = taskAdvice(task, parked);
  const activeHandoff = handedOff && manualOpen && !finished && !parked;
  return (
    <article
      className={`focus-card${activeHandoff ? " handoff-active" : ""}`}
      aria-labelledby="focus-title"
    >
      <h2 ref={titleRef} tabIndex={-1} id="focus-title">
        {activeHandoff ? "Your message" : advice.title}
      </h2>
      <p className="work-reference">
        Work: <strong>{context?.title || taskName(task.branch)}</strong>
      </p>
      {!activeHandoff && <p className="focus-reason">{advice.explanation}</p>}
      {!finished && !parked && (
        <details
          className="manual-handoff"
          onToggle={(event) => {
            setManualOpen(event.currentTarget.open);
            if (!event.currentTarget.open) setHandedOff(false);
          }}
        >
          <summary>Send a message manually</summary>
          {manualOpen && (
            <AgentRequest
              guided
              onCopied={() => setHandedOff(true)}
              onRestart={() => setHandedOff(false)}
              worktree={task}
              status={status}
              context={context}
              disabled={disabled}
            />
          )}
        </details>
      )}
      <details
        className="optional-details"
        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
      >
        <summary>About this work</summary>
        {detailsOpen && (
          <>
            <p className="helper">
              {context?.title
                ? "This name was saved on this computer."
                : "This name comes from a code label. You can give it a name you recognize below."}
            </p>
            {context?.purpose && <p>{context.purpose}</p>}
            <p className="helper">
              {context?.owner
                ? `AI chat: ${context.owner}`
                : "No AI chat name has been saved. Use the conversation where you asked for this work."}
            </p>
            <BranchDetails
              worktree={task}
              status={status}
              context={context}
              disabled={disabled}
              onAction={onAction}
              showHandoff={false}
            />
          </>
        )}
      </details>
    </article>
  );
}
