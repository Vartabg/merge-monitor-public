import { privateStateFile } from "./private-state-file.mjs";
import { validTaskContext } from "./task-context.mjs";

export async function createStateStore(path) {
  const file = await privateStateFile(path);
  let state = { version: 1, enabled: false, history: [], taskContexts: [] };
  try {
    const value = await file.read();
    if (
      value.version !== 1 ||
      typeof value.enabled !== "boolean" ||
      !Array.isArray(value.history) ||
      (value.taskContexts !== undefined &&
        (!Array.isArray(value.taskContexts) ||
          !value.taskContexts.every(
            (item) =>
              validTaskContext(item) && typeof item.updatedAt === "string",
          )))
    )
      throw new Error(
        "Invalid monitor state. Restore a valid state file before enabling the worker.",
      );
    state = {
      version: 1,
      enabled: value.enabled,
      history: value.history.slice(0, 100),
      taskContexts: value.taskContexts || [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let tail = Promise.resolve();
  return {
    get: () => structuredClone(state),
    update: (change) => {
      const pending = tail.then(async () => {
        const next = change(structuredClone(state));
        await file.save(next);
        state = next;
        return structuredClone(state);
      });
      tail = pending.catch(() => undefined); // Callers receive the rejection; the next write can recover.
      return pending;
    },
  };
}
