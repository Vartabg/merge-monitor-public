import type { Worktree } from "./types";

// Translate observed state; never invent a feature outcome or chat owner.
export function taskAdvice(task: Worktree, parked: boolean) {
  if (parked)
    return {
      title: "This work is on hold.",
      explanation: "There is nothing to do here until you decide to continue.",
    };
  if (task.category === "finished")
    return {
      title: "These changes have been combined.",
      explanation:
        "They are in the main copy on this computer. This does not tell us whether they are live on your website or app.",
    };
  if (task.inspectionError)
    return {
      title: "We could not check this work.",
      explanation:
        "Ask your AI chat to find out why the check could not finish.",
    };
  if (
    task.preview?.outcome === "conflict" ||
    task.state === "CONFLICT-WITH-BASE"
  )
    return {
      title: "These changes need a fix.",
      explanation:
        "Two versions of this work do not fit together yet. They need to be checked before being combined.",
    };
  if (task.overlappingFiles.length)
    return {
      title: "These changes need a check.",
      explanation:
        "Two pieces of work change the same files. Check how they should fit together.",
    };
  if (task.category === "ready")
    return {
      title: "Ready for review and tests.",
      explanation:
        "The saved changes fit together. Review and tests still need to check that they work.",
    };
  if (task.state === "NEEDS-SYNC" || task.preview?.outcome === "stale")
    return {
      title: "A fresh check is needed.",
      explanation:
        "We need another check before deciding what to do with this work.",
    };
  return {
    title: "This work is unfinished.",
    explanation:
      "This work is not ready for a final check yet. The changes still need to be finished and checked.",
  };
}
