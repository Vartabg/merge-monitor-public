const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const response = (name) => ({
  description: name,
  content: { "application/json": { schema: ref(name) } },
});
export const operation = (name, input, code = 200) => ({
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
