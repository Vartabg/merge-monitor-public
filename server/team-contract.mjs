const text = (maxLength, minLength = 0) => ({
  type: "string",
  maxLength,
  minLength,
});
const object = (properties, optional = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const list = (name, maxItems) => ({
  type: "array",
  maxItems,
  items: ref(name),
});
const uuid = {
  type: "string",
  pattern: "^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$",
};
const who = { project: text(120, 1), agent: text(80, 1) };
const run = { ...who, runId: uuid };
export const teamSchemas = {
  TeamIdentity: object(who),
  TeamClaim: object({ ...who, assignmentId: uuid, requestId: uuid }),
  TeamStart: object({ ...run, adapter: text(80, 1) }),
  TeamRenew: object(run),
  TeamFinish: object({
    ...run,
    status: { enum: ["review", "blocked"] },
    summary: text(1200, 1),
    artifacts: { type: "array", maxItems: 5, items: text(1024, 1) },
    requestId: uuid,
  }),
  TeamCancel: object({ ...run, summary: text(1200, 1) }),
  TeamAbandon: object({ ...run, summary: text(1200, 1) }),
  TeamRun: object(
    {
      ...run,
      assignmentId: uuid,
      assignmentRevision: { type: "integer", minimum: 1 },
      finishAssignmentRevision: { type: "integer", minimum: 1 },
      startAssignmentRevision: { type: "integer", minimum: 1 },
      cleanupAssignmentRevision: { type: "integer", minimum: 1 },
      phase: {
        enum: [
          "claimed",
          "running",
          "review",
          "blocked",
          "expired",
          "cancelled",
        ],
      },
      requestId: uuid,
      finishRequestId: text(36),
      adapter: text(80),
      createdAt: text(40, 1),
      updatedAt: text(40, 1),
      leaseUntil: text(40, 1),
      summary: text(1200),
      artifacts: { type: "array", maxItems: 5, items: text(1024, 1) },
    },
    [
      "finishAssignmentRevision",
      "startAssignmentRevision",
      "cleanupAssignmentRevision",
    ],
  ),
  TeamInbox: object({
    version: { const: 1 },
    ...who,
    assignments: list("Assignment", 20),
    reviews: list("Assignment", 20),
    requests: list("BoardMessage", 8),
    runs: list("TeamRun", 20),
    counts: object({
      assignments: { type: "integer" },
      reviews: { type: "integer" },
      requests: { type: "integer" },
      runs: { type: "integer" },
    }),
  }),
  TeamRuns: object({
    version: { const: 1 },
    project: text(120, 1),
    runs: list("TeamRun", 500),
  }),
};
const operation = (output, input) => ({
  ...(input
    ? {
        security: [{ sessionToken: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref(input) } },
        },
      }
    : {}),
  responses: Object.fromEntries(
    [
      [200, output],
      [400, "Error"],
      [403, "Error"],
      [404, "Error"],
      [405, "Error"],
      [409, "Error"],
      [500, "Error"],
      [503, "Error"],
    ].map(([code, name]) => [
      code,
      {
        description: name,
        content: { "application/json": { schema: ref(name) } },
      },
    ]),
  ),
});
export const teamPaths = {
  "/api/team/inbox": {
    get: {
      ...operation("TeamInbox"),
      parameters: ["project", "agent"].map((name) => ({
        name,
        in: "query",
        required: true,
        schema: who[name],
      })),
    },
  },
  "/api/team/runs": {
    get: {
      ...operation("TeamRuns"),
      parameters: [
        { name: "project", in: "query", required: true, schema: text(120, 1) },
      ],
    },
  },
  ...Object.fromEntries(
    ["claim", "start", "renew", "finish", "cancel", "abandon"].map(
      (command) => [
        "/api/team/" + command,
        {
          post: operation(
            "TeamRun",
            "Team" + command[0].toUpperCase() + command.slice(1),
          ),
        },
      ],
    ),
  ),
};
