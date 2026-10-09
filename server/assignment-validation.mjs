// Validation for the bounded local assignment store. Fail closed with
// plain 400-coded errors; the store maps domain conflicts to 404/409.
export const createFields = ["title", "project", "purpose", "owner",
  "model", "reviewer", "scope", "acceptance", "budget"];
export const updateFields = ["id", "revision", "status", "summary",
  "artifacts", "reviewNote"];
export const STATUSES = ["queued", "working", "review", "accepted", "blocked"];
export const TRANSITIONS = { queued: ["working", "blocked"],
  working: ["review", "blocked"], review: ["accepted", "working", "blocked"],
  blocked: ["queued", "working"], accepted: [] };
export const MAX_ASSIGNMENTS = 500;
export const MAX_WORKING = 3;
export const MAX_HISTORY = 50;
export const CREATE_LIMITS = { title: [1, 120], project: [1, 120],
  purpose: [1, 800], owner: [1, 120], model: [1, 120], reviewer: [1, 120],
  scope: [1, 1600], acceptance: [1, 1600], budget: [1, 400] };
const MULTILINE_CREATE = new Set(["purpose", "scope", "acceptance"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_NAMES = new Set([...createFields, "id", "revision", "status",
  "summary", "artifacts", "reviewNote", "createdAt", "updatedAt", "history"]);

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(input, fields, label) {
  if (!isRecord(input)) fail(`${label} input must be an object.`);
  for (const key of Object.keys(input))
    if (!fields.includes(key)) fail(`Unknown ${label} field: ${key}.`);
  for (const field of fields)
    if (!(field in input)) fail(`Missing ${label} field: ${field}.`);
}

function badControls(value, multiline) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 0x20 || code === 0x7f) {
      if (multiline && (char === "\n" || char === "\t")) continue;
      return true;
    }
  }
  return false;
}

function cleanString(value, field, min, max, multiline) {
  if (typeof value !== "string") fail(`Field ${field} must be a string.`);
  const trimmed = (multiline ? value.replaceAll("\r\n", "\n") : value).trim();
  if (trimmed.length < min || trimmed.length > max)
    fail(`Field ${field} must be ${min}..${max} characters.`);
  if (badControls(trimmed, multiline))
    fail(`Field ${field} contains disallowed control characters.`);
  return trimmed;
}

export function validateCreateInput(input) {
  assertExactKeys(input, createFields, "create");
  const clean = {};
  for (const field of createFields)
    clean[field] = cleanString(input[field], field,
      ...CREATE_LIMITS[field], MULTILINE_CREATE.has(field));
  if (clean.reviewer.toLowerCase() === clean.owner.toLowerCase())
    fail("Reviewer must differ from owner.");
  return clean;
}

export function validateArtifactValue(value, index) {
  const trimmed = cleanString(value, `artifacts[${index}]`, 1, 1024, false);
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//")) fail(`Artifact ${index} is not a valid path.`);
    return trimmed;
  }
  let url = null;
  try {
    url = new URL(trimmed);
  } catch {
    fail(`Artifact ${index} must be an absolute path or http(s) URL.`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" || url.password !== "" || url.host === "")
    fail(`Artifact ${index} must be an absolute path or http(s) URL.`);
  return trimmed;
}

export function validateUpdateInput(input) {
  assertExactKeys(input, updateFields, "update");
  const { id, revision, status, summary, artifacts, reviewNote } = input;
  const cleanId = cleanString(id, "id", 1, 120, false);
  if (!UUID_RE.test(cleanId)) fail("Field id must be a UUID.");
  if (!Number.isInteger(revision) || revision <= 0)
    fail("Field revision must be a positive integer.");
  if (typeof status !== "string" || !STATUSES.includes(status))
    fail("Field status must be a known assignment status.");
  if (!Array.isArray(artifacts) || artifacts.length > 5)
    fail("Field artifacts must be an array of up to 5 entries.");
  return { id: cleanId, revision, status,
    summary: cleanString(summary, "summary", 1, 1200, true),
    artifacts: artifacts.map((entry, index) =>
      validateArtifactValue(entry, index)),
    reviewNote: cleanString(reviewNote, "reviewNote", 0, 1600, true) };
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function assertHistoryEvent(event, index) {
  if (!isRecord(event)) fail(`History event ${index} must be an object.`);
  const keys = Object.keys(event);
  if (keys.length !== 3 || !keys.includes("at") ||
      !keys.includes("status") || !keys.includes("summary"))
    fail(`History event ${index} has unexpected shape.`);
  if (!isIsoDate(event.at)) fail(`History event ${index} needs an ISO date.`);
  if (!STATUSES.includes(event.status))
    fail(`History event ${index} has an unknown status.`);
  cleanString(event.summary, `history[${index}].summary`, 1, 1200, true);
}

export function validateRecord(record) {
  if (!isRecord(record)) fail("Assignment record must be an object.");
  for (const key of Object.keys(record))
    if (!RECORD_NAMES.has(key)) fail(`Record has unexpected field: ${key}.`);
  for (const key of RECORD_NAMES)
    if (!(key in record)) fail(`Record is missing field: ${key}.`);
  for (const field of createFields)
    cleanString(record[field], field,
      ...CREATE_LIMITS[field], MULTILINE_CREATE.has(field));
  if (!UUID_RE.test(record.id)) fail("Record id must be a UUID.");
  if (!Number.isInteger(record.revision) || record.revision <= 0)
    fail("Record revision must be a positive integer.");
  if (!STATUSES.includes(record.status)) fail("Record has unknown status.");
  if (record.owner.trim().toLowerCase() === record.reviewer.trim().toLowerCase())
    fail("Record reviewer must differ from owner.");
  if (!Array.isArray(record.artifacts) || record.artifacts.length > 5)
    fail("Record artifacts must be an array of up to 5 entries.");
  record.artifacts.forEach((entry, index) =>
    validateArtifactValue(entry, index));
  const minSummary = Array.isArray(record.history) && record.history.length > 1
    ? 1 : 0;
  cleanString(record.summary, "summary", minSummary, 1200, true);
  cleanString(record.reviewNote, "reviewNote", 0, 1600, true);
  if (!isIsoDate(record.createdAt) || !isIsoDate(record.updatedAt))
    fail("Record needs ISO createdAt and updatedAt dates.");
  if (!Array.isArray(record.history) || record.history.length < 1 ||
      record.history.length > MAX_HISTORY)
    fail("Record history must hold 1..50 events.");
  record.history.forEach(assertHistoryEvent);
  if (record.revision <= MAX_HISTORY && record.history[0].status !== "queued")
    fail("Record history must start at queued.");
  const last = record.history[record.history.length - 1];
  if (last.status !== record.status) fail("Record status must match history.");
  if (record.history.length < MAX_HISTORY
    ? record.revision !== record.history.length
    : record.revision < MAX_HISTORY)
    fail("Record revision must match history length.");
  if (record.status === "accepted" &&
      (record.artifacts.length < 1 || record.reviewNote.trim() === ""))
    fail("Accepted records need an artifact and a review note.");
  return true;
}

export function validateState(state) {
  if (!isRecord(state)) fail("Assignment state must be an object.");
  const keys = Object.keys(state);
  if (keys.length !== 2 || !keys.includes("version") ||
      !keys.includes("assignments"))
    fail("Assignment state has unexpected shape.");
  if (state.version !== 1) fail("Assignment state version must be 1.");
  if (!Array.isArray(state.assignments))
    fail("Assignment state must hold an assignments array.");
  if (state.assignments.length > MAX_ASSIGNMENTS)
    fail("Assignment state exceeds 500 assignments.");
  const seen = new Set();
  for (const record of state.assignments) {
    validateRecord(record);
    if (seen.has(record.id)) fail("Assignment ids must be unique.");
    seen.add(record.id);
  }
  return true;
}
