import { boardSchemas, boardPaths } from "./board-contract.mjs";
import { assignmentSchemas, assignmentPaths } from "./assignment-contract.mjs";

const string = { type: "string" },
  number = { type: "number" },
  boolean = { type: "boolean" };
const list = (items) => ({ type: "array", items });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (value) => ({ anyOf: [value, { type: "null" }] });
const choice = (values) => ({ type: "string", enum: values });
const object = (properties, optional = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
});

const schemas = {
  ...assignmentSchemas,
  ...boardSchemas,
  TaskContext: object({
    repoId: string,
    path: string,
    branch: string,
    title: { type: "string", maxLength: 120 },
    purpose: { type: "string", maxLength: 800 },
    owner: { type: "string", maxLength: 120 },
    updatedAt: string,
  }),
  TaskContextRequest: object({
    repoId: { type: "string", minLength: 1, maxLength: 120 },
    path: { type: "string", minLength: 1, maxLength: 1024 },
    branch: { type: "string", minLength: 1, maxLength: 300 },
    title: { type: "string", maxLength: 120 },
    purpose: { type: "string", maxLength: 800 },
    owner: { type: "string", maxLength: 120 },
  }),
  Repo: object(
    {
      id: string,
      label: string,
      path: string,
      defaultBranch: string,
      excludedBranches: list(string),
    },
    ["defaultBranch"],
  ),
  Repos: object({ repos: list(ref("Repo")), defaultRepo: string }),
  Preview: object({
    branch: string,
    headSha: string,
    baseSha: string,
    baseRef: string,
    checkedAt: string,
    files: list(string),
    outcome: choice(["clean", "conflict", "stale"]),
    message: string,
  }),
  Worktree: object(
    {
      path: string,
      branch: string,
      primary: boolean,
      state: string,
      dirty: number,
      ahead: number,
      behind: number,
      upstream: nullable(string),
      headSha: string,
      lastCommit: string,
      changedFiles: list(string),
      isDirty: boolean,
      merged: boolean,
      preview: nullable(ref("Preview")),
      inspectionError: string,
      category: choice(["attention", "ready", "working", "finished"]),
      reason: string,
      nextAction: string,
      overlappingFiles: list(string),
      checks: choice(["not-run"]),
    },
    ["inspectionError"],
  ),
  Conflict: object({ file: string, branches: list(string) }),
  Status: object({
    repoId: string,
    label: string,
    baseRef: string,
    baseSha: string,
    generatedAt: string,
    durationMs: number,
    incomplete: boolean,
    worktrees: list(ref("Worktree")),
    conflicts: list(ref("Conflict")),
    fileMapSize: number,
  }),
  Worker: object({
    enabled: boolean,
    status: choice(["paused", "idle", "running", "error"]),
    heartbeat: string,
    lastRun: nullable(string),
    error: nullable(string),
  }),
  Event: object({
    id: string,
    at: string,
    repoId: string,
    branch: string,
    source: choice(["manual", "worker"]),
    outcome: choice(["clean", "conflict", "stale", "error", "setting"]),
    message: string,
    headSha: string,
    baseSha: string,
  }),
  StatusResponse: object({
    repoId: string,
    status: nullable(ref("Status")),
    error: nullable(string),
    refreshing: boolean,
    stale: boolean,
    worker: ref("Worker"),
    history: list(ref("Event")),
    taskContexts: list(ref("TaskContext")),
  }),
  Error: object({ error: string }),
  Session: object({ token: string }),
  Health: object({ ok: boolean, version: string, at: string }),
  Accepted: object({ accepted: boolean }),
  PreviewRequest: object({
    repoId: string,
    branch: string,
    headSha: string,
    baseSha: string,
  }),
  RefreshRequest: object({ repoId: string }),
  WorkerRequest: object({ enabled: boolean }),
  Empty: object({}),
};
const response = (name) => ({
  description: name,
  content: { "application/json": { schema: ref(name) } },
});
const operation = (name, input, code = 200) => ({
  ...(input
    ? {
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref(input) } },
        },
        security: [{ sessionToken: [] }],
      }
    : {}),
  responses: {
    [code]: response(name),
    400: response("Error"),
    403: response("Error"),
    404: response("Error"),
    409: response("Error"),
    500: response("Error"),
  },
});
export const contract = {
  openapi: "3.1.0",
  info: { title: "Merge Monitor local API", version: "0.8.1" },
  components: {
    schemas,
    securitySchemes: {
      sessionToken: {
        type: "apiKey",
        in: "header",
        name: "X-Merge-Monitor-Token",
      },
    },
  },
  paths: {
    ...assignmentPaths,
    ...boardPaths,
    "/api/health": { get: operation("Health") },
    "/api/session": { get: operation("Session") },
    "/api/repos": { get: operation("Repos") },
    "/api/status": {
      get: {
        ...operation("StatusResponse"),
        parameters: [{ name: "repo", in: "query", schema: string }],
      },
    },
    "/api/refresh": { post: operation("Accepted", "RefreshRequest", 202) },
    "/api/preview": { post: operation("Preview", "PreviewRequest") },
    "/api/task-context": {
      post: operation("TaskContext", "TaskContextRequest"),
    },
    "/api/worker": { post: operation("Worker", "WorkerRequest") },
    "/api/worker/run": { post: operation("Worker", "Empty") },
  },
};
