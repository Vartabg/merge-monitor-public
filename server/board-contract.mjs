const text = (maxLength, minLength = 0) => ({
  type: "string",
  minLength,
  maxLength,
});
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const list = (items, maxItems) => ({ type: "array", items, maxItems });
const id = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$" };
const uuid = {
  type: "string",
  pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
};
const sequence = { type: "integer", minimum: 0 };
const kind = {
  type: "string",
  enum: ["update", "decision", "question", "blocker", "handoff"],
};
const state = { type: "string", enum: ["working", "blocked", "idle", "done"] };
const who = { project: id, agent: id };
const checkin = { ...who, task: text(300, 1), scope: text(800), state };
const post = {
  ...who,
  to: text(80),
  kind,
  text: text(4000, 1),
  replyTo: text(36),
  requestId: uuid,
};
const action = { ...who, messageId: uuid };
export const boardSchemas = {
  BoardRead: object(who),
  BoardCheckIn: object(checkin),
  BoardPost: object(post),
  BoardAction: object(action),
  BoardGoal: object({ ...who, goal: text(1200, 1), revision: sequence }),
  BoardMember: object({
    agent: id,
    task: text(300, 1),
    scope: text(800),
    state,
    checkedInAt: text(40, 1),
    lastReadAt: text(40),
    lastReadSequence: sequence,
  }),
  BoardMessage: object({
    ...post,
    id: uuid,
    sequence,
    at: text(40, 1),
    acknowledgedAt: text(40),
    resolvedAt: text(40),
    resolvedBy: text(80),
  }),
  BoardRoom: object({
    project: id,
    goal: text(1200),
    goalBy: text(80),
    goalAt: text(40),
    revision: sequence,
    members: list(ref("BoardMember"), 100),
    messages: list(ref("BoardMessage"), 1000),
  }),
  BoardState: object({
    version: { const: 1, type: "integer" },
    rooms: list(ref("BoardRoom"), 100),
  }),
  Board: object({
    room: ref("BoardRoom"),
    asOf: text(40, 1),
    unreadIds: list(uuid, 1000),
    pendingIds: list(uuid, 1000),
  }),
};
const response = (name) => ({
  description: name,
  content: { "application/json": { schema: ref(name) } },
});
const operation = (input) => ({
  ...(input
    ? {
        security: [{ sessionToken: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref(input) } },
        },
      }
    : {}),
  responses: {
    200: response("Board"),
    400: response("Error"),
    403: response("Error"),
    404: response("Error"),
    409: response("Error"),
    413: response("Error"),
    500: response("Error"),
  },
});
export const boardPaths = {
  "/api/board": {
    get: {
      ...operation(),
      parameters: [
        { name: "project", in: "query", required: true, schema: id },
      ],
    },
  },
  ...Object.fromEntries(
    Object.entries({
      read: "BoardRead",
      "check-in": "BoardCheckIn",
      post: "BoardPost",
      ack: "BoardAction",
      resolve: "BoardAction",
      goal: "BoardGoal",
    }).map(([path, schema]) => [
      `/api/board/${path}`,
      { post: operation(schema) },
    ]),
  ),
};
