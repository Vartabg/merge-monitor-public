import { privateStateFile } from "./private-state-file.mjs";
import { validateState } from "./execution-validation.mjs";

// Single server owns the file. Refuse unsafe existing paths instead of changing
// other components' permissions. Atomic replacement is not a power-loss guarantee.
export async function executionFile(path) {
  const file = await privateStateFile(path, { maxBytes: 8 * 1024 * 1024 });
  let state = { version: 1, runs: [] };
  try { state = await file.read(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  validateState(state);
  return { state, async save(next) {
    validateState(next);
    await file.save(next);
  } };
}
