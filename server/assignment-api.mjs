import { createFields, updateFields } from "./assignment-validation.mjs";

const fail = (message, statusCode) => {
  throw Object.assign(new Error(message), { statusCode });
};
export async function assignmentRequest(path, req, store, readBody) {
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
      return { code: 200, data: { assignments: store.list() } };
    const update = path.endsWith("/update");
    const value = await readBody(
      req,
      update ? updateFields : createFields,
      16384,
    );
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
