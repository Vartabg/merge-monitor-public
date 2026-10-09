export function time(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
export const shortRef = (value: string) =>
  value.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
export const categories = [
  {
    id: "attention",
    label: "Needs attention",
    help: "Open a task and ask its agent to check it.",
  },
  {
    id: "ready",
    label: "Ready for review",
    help: "Ask the agent to review and test next.",
  },
  {
    id: "working",
    label: "In progress",
    help: "Let the agent finish and verify its work.",
  },
  {
    id: "finished",
    label: "Already combined",
    help: "In the local main version. Deployment unknown.",
  },
] as const;
