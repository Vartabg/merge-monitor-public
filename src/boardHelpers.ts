import type { components } from "./api.generated";

export type Report = components["schemas"]["Board"];
export type Message = components["schemas"]["BoardMessage"];
export type Member = components["schemas"]["BoardMember"];

export const labels: Record<Message["kind"], string> = {
  update: "Update",
  decision: "Decision",
  question: "Question",
  blocker: "Needs help",
  handoff: "Ready for the next agent",
};

export const person = (agent: string) => (agent === "human" ? "You" : agent);

export const requestKinds: Message["kind"][] = [
  "question",
  "blocker",
  "handoff",
];

export const findingRows: [keyof NonNullable<Message["finding"]>, string][] = [
  ["claim", "Claim"],
  ["evidence", "Evidence"],
  ["expected", "Expected"],
  ["actual", "Actual"],
  ["scope", "Scope"],
  ["doneCheck", "Done check"],
];

// Matches the server default for messages saved before attention existed.
export const isFyi = (m: Message) =>
  (m.attention || (requestKinds.includes(m.kind) ? "action" : "fyi")) ===
  "fyi";

export const formatDate = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
