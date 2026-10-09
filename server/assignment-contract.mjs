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
const status = {
  type: "string",
  enum: ["queued", "working", "review", "accepted", "blocked"],
};
const date = { type: "string" };
const identity = text(36, 36);
const revision = { type: "integer", minimum: 1 };
const fields = {
  title: text(120, 1),
  project: text(120, 1),
  purpose: text(800, 1),
  owner: text(120, 1),
  model: text(120, 1),
  reviewer: text(120, 1),
  scope: text(1600, 1),
  acceptance: text(1600, 1),
  budget: text(400, 1),
};
const artifacts = { type: "array", maxItems: 5, items: text(1024, 1) };
export const assignmentSchemas = {
  AssignmentCreate: object(fields),
  AssignmentUpdate: object({
    id: identity,
    revision,
    status,
    summary: text(1200, 1),
    artifacts,
    reviewNote: text(1600),
  }),
  AssignmentEvent: object({ at: date, status, summary: text(1200, 1) }),
  Assignment: object({
    ...fields,
    id: identity,
    revision,
    status,
    summary: text(1200),
    artifacts,
    reviewNote: text(1600),
    createdAt: date,
    updatedAt: date,
    history: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: ref("AssignmentEvent"),
    },
  }),
  Assignments: object({
    assignments: { type: "array", maxItems: 500, items: ref("Assignment") },
  }),
};
const response = (schema) => ({
  description: schema,
  content: { "application/json": { schema: ref(schema) } },
});
const operation = (schema, input, code = 200) => ({
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
    [code]: response(schema),
    400: response("Error"),
    403: response("Error"),
    404: response("Error"),
    405: response("Error"),
    409: response("Error"),
    413: response("Error"),
    415: response("Error"),
    500: response("Error"),
  },
});
export const assignmentPaths = {
  "/api/assignments": {
    get: operation("Assignments"),
    post: operation("Assignment", "AssignmentCreate", 201),
  },
  "/api/assignments/update": {
    post: operation("Assignment", "AssignmentUpdate"),
  },
};
