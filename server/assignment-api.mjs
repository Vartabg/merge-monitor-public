import {
  createFields,
  updateFields,
  validateCreateInput,
} from "./assignment-validation.mjs";
import { validateParticipants } from "./assignment-participants.mjs";

const fail = (message, statusCode) => {
  throw Object.assign(new Error(message), { statusCode });
};
export async function assignmentRequest(
  path,
  req,
  store,
  readBody,
  monitor,
  board,
  executions,
) {
  if (!["/api/assignments", "/api/assignments/update"].includes(path))
    fail("This assignment endpoint does not exist.", 404);
  if (path === "/api/assignments/update" && req.method !== "POST")
    fail("Use POST to update an assignment.", 405);
  if (!["GET", "POST"].includes(req.method))
    fail("Use GET or POST for assignments.", 405);
  if (!store)
    fail(
      "The assignment queue is unavailable. Restart Merge Monitor and try again.",
      503,
    );
  try {
    if (req.method === "GET")
      return {
        code: 200,
        data: {
          assignments: store.list(),
          ...(executions
            ? {
                capacity: {
                  assignments: { used: store.list().length, limit: 500 },
                  runs: executions.capacity(),
                },
              }
            : {}),
        },
      };
    const update = path.endsWith("/update");
    const value = await readBody(
      req,
      update ? updateFields : createFields,
      16384,
    );
    if (!update)
      validateParticipants(validateCreateInput(value), monitor, board);
    return {
      code: update ? 200 : 201,
      data: await store[update ? "update" : "create"](value),
    };
  } catch (error) {
    if (error.statusCode) throw error;
    fail(
      "The assignment could not be saved. Check the local state folder and try again.",
      500,
    );
  }
}
