import type { components } from "./api.generated";
export type Assignment = components["schemas"]["Assignment"];
export type AssignmentCreate = components["schemas"]["AssignmentCreate"];
export type AssignmentUpdate = components["schemas"]["AssignmentUpdate"];
export type Assignments = components["schemas"]["Assignments"];
export const progressLabels: Record<Assignment["status"], string> = {
  queued: "Queued",
  working: "Work underway",
  review: "Ready for review",
  accepted: "Accepted after review",
  blocked: "Needs help",
};
