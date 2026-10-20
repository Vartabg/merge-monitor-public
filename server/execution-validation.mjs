import { validateArtifactValue } from "./assignment-validation.mjs";

export const MAX_RUNS = 500;
export const RESERVING = new Set(["claimed", "running", "expired"]);
const PHASES = [...RESERVING, "review", "blocked", "cancelled"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY = ["project", "agent", "runId"];
const INPUTS = {
  claim: ["project", "agent", "assignmentId", "requestId"],
  start: [...IDENTITY, "adapter"], renew: IDENTITY,
  finish: [...IDENTITY, "status", "summary", "artifacts", "requestId"],
  cancel: [...IDENTITY, "summary"], abandon: [...IDENTITY, "summary"],
};
const FIELDS = ["runId", "assignmentId", "assignmentRevision", "project", "agent",
  "phase", "requestId", "finishRequestId", "adapter", "createdAt", "updatedAt",
  "leaseUntil", "summary", "artifacts"];
const PUBLICATION_FIELDS = ["startAssignmentRevision", "finishAssignmentRevision", "cleanupAssignmentRevision"];

export function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function exact(input, fields, label) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(`${label} must be an object.`);
  if (Object.keys(input).length !== fields.length ||
      fields.some(field => !Object.hasOwn(input, field)))
    fail(`${label} has missing or unexpected fields.`);
}
export function text(value, field, min = 1, max = 120, multiline = false) {
  if (typeof value !== "string") fail(`${field} must be a string.`);
  const clean = (multiline ? value.replaceAll("\r\n", "\n") : value).trim();
  const controls = [...clean].some(char => (char.codePointAt(0) < 32 ||
    char.codePointAt(0) === 127) && !(multiline && ["\n", "\t"].includes(char)));
  if (clean.length < min || clean.length > max || controls)
    fail(`${field} has invalid length or control characters.`);
  return clean;
}
function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) fail(`${field} must be a UUID.`);
  return value.toLowerCase();
}
function artifacts(value) {
  if (!Array.isArray(value) || value.length > 5) fail("artifacts needs up to 5 entries.");
  return value.map(validateArtifactValue);
}
function iso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail("Run timestamps must be ISO dates.");
}
export function validateInput(kind, input) {
  exact(input, INPUTS[kind], kind);
  const clean = { project: text(input.project, "project"), agent: text(input.agent, "agent") };
  for (const field of ["runId", "assignmentId", "requestId"])
    if (Object.hasOwn(input, field)) clean[field] = uuid(input[field], field);
  if (kind === "start") clean.adapter = text(input.adapter, "adapter");
  if (["cancel", "abandon", "finish"].includes(kind))
    clean.summary = text(input.summary, "summary", 1, 1200, true);
  if (kind === "finish") {
    if (!["review", "blocked"].includes(input.status)) fail("finish status must be review or blocked.");
    clean.status = input.status; clean.artifacts = artifacts(input.artifacts);
  }
  return clean;
}
export function assignmentBinding(value) {
  if (!value || typeof value !== "object") fail("An authoritative assignment is required.");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    fail("Assignment revision must be a positive integer.");
  return { id: uuid(value.id, "assignment id"), revision: value.revision,
    project: text(value.project, "assignment project"),
    owner: text(value.owner, "assignment owner"), status: text(value.status, "assignment status") };
}
export function validateRun(run) {
  exact(run, [...FIELDS, ...PUBLICATION_FIELDS.filter(field => Object.hasOwn(run ?? {}, field))], "Run record");
  for (const field of ["runId", "assignmentId", "requestId", "finishRequestId"])
    if (run[field] !== "" || field !== "finishRequestId")
      if (uuid(run[field], field) !== run[field]) fail("Saved UUIDs must be canonical.");
  if (!Number.isSafeInteger(run.assignmentRevision) || run.assignmentRevision < 1)
    fail("Run assignmentRevision must be positive.");
  for (const field of ["project", "agent", "adapter", "summary"])
    if (text(run[field], field, ["project", "agent"].includes(field) ? 1 : 0,
      field === "summary" ? 1200 : 120, field === "summary") !== run[field])
      fail("Saved run fields must be canonical.");
  if (JSON.stringify(artifacts(run.artifacts)) !== JSON.stringify(run.artifacts))
    fail("Saved artifacts must be canonical.");
  if (!PHASES.includes(run.phase)) fail("Unknown run phase.");
  for (const field of ["createdAt", "updatedAt", "leaseUntil"]) iso(run[field]);
  if (Date.parse(run.updatedAt) < Date.parse(run.createdAt) ||
      Date.parse(run.leaseUntil) < Date.parse(run.createdAt) ||
      (Date.parse(run.leaseUntil) === Date.parse(run.createdAt) &&
        !["expired", "cancelled"].includes(run.phase)))
    fail("Run timestamps are inconsistent.");
  const finished = ["review", "blocked"].includes(run.phase);
  for (const field of PUBLICATION_FIELDS.filter(key => Object.hasOwn(run, key))) {
    const phaseMatches = field === "startAssignmentRevision" ? run.phase !== "claimed"
      : field === "finishAssignmentRevision" ? finished : ["expired", "cancelled"].includes(run.phase);
    if (!phaseMatches || !Number.isSafeInteger(run[field]) || run[field] < run.assignmentRevision ||
        (field !== "startAssignmentRevision" && run[field] < (run.startAssignmentRevision || 0)))
      fail("Run publication revision is inconsistent. Restore a valid execution record.");
  }
  if (finished !== (run.finishRequestId !== "") ||
      (finished && (!run.adapter || !run.summary)) ||
      (run.phase === "running" && !run.adapter) ||
      (run.phase === "claimed" && run.adapter !== "") ||
      (["claimed", "running"].includes(run.phase) && run.summary !== "") ||
      (!finished && run.artifacts.length !== 0) ||
      (run.phase === "cancelled" && !run.summary)) fail("Run phase fields are inconsistent.");
  return true;
}
export function validateState(state) {
  exact(state, ["version", "runs"], "Execution state");
  if (state.version !== 1 || !Array.isArray(state.runs) || state.runs.length > MAX_RUNS)
    fail("Execution state needs version 1 and at most 500 runs.");
  const ids = new Set(), requests = new Set(), reservations = new Set();
  for (const run of state.runs) {
    validateRun(run);
    if (ids.has(run.runId.toLowerCase())) fail("Run ids must be unique.");
    ids.add(run.runId.toLowerCase());
    for (const request of [run.requestId, run.finishRequestId].filter(Boolean)) {
      if (requests.has(request.toLowerCase())) fail("Execution request ids must be unique.");
      requests.add(request.toLowerCase());
    }
    const key = run.assignmentId.toLowerCase();
    if (RESERVING.has(run.phase) && reservations.has(key)) fail("Duplicate assignment reservation.");
    if (RESERVING.has(run.phase)) reservations.add(key);
  }
  return true;
}
