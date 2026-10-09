import { readFile, writeFile, rename, mkdir, chmod, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_ASSIGNMENTS,
  MAX_HISTORY,
  MAX_WORKING,
  TRANSITIONS,
  validateCreateInput,
  validateRecord,
  validateState,
  validateUpdateInput,
} from "./assignment-validation.mjs";

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  throw error;
}

function missing(message) {
  const error = new Error(message);
  error.statusCode = 404;
  throw error;
}

// Durable coordinator-recorded assignments. Single server owns each state
// file, so no external locks: writes serialize in one promise chain and
// revision checks run inside the serialized transaction.
export async function createAssignmentStore(path) {
  let state;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw error;
      throw new Error(`Invalid assignment state at ${path}: not valid JSON.`, { cause: error });
    }
    validateState(parsed);
    state = { version: 1, assignments: structuredClone(parsed.assignments) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      state = { version: 1, assignments: [] };
    } else {
      throw error;
    }
  }

  async function persist(next) {
    validateState(next);
    const directory = dirname(path);
    try {
      await stat(directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), {
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  }

  let tail = Promise.resolve();
  function enqueue(task) {
    const pending = tail.then(task);
    tail = pending.catch(() => undefined);
    return pending;
  }

  return {
    list() {
      return structuredClone(state.assignments);
    },
    async create(input) {
      const clean = validateCreateInput(input);
      return enqueue(async () => {
        if (state.assignments.length >= MAX_ASSIGNMENTS) {
          conflict("Maximum 500 assignments reached.");
        }
        const now = new Date().toISOString();
        const record = {
          ...clean,
          id: randomUUID(),
          revision: 1,
          status: "queued",
          summary: "",
          artifacts: [],
          reviewNote: "",
          createdAt: now,
          updatedAt: now,
          history: [{ at: now, status: "queued", summary: "Assignment created." }],
        };
        const next = {
          version: 1,
          assignments: [...state.assignments, record],
        };
        await persist(next);
        state = next;
        return structuredClone(record);
      });
    },
    async update(input) {
      const clean = validateUpdateInput(input);
      return enqueue(async () => {
        const current = state.assignments.find((item) => item.id === clean.id);
        if (!current) missing(`Unknown assignment id: ${clean.id}.`);
        if (clean.revision !== current.revision) {
          conflict(`Stale revision for assignment ${clean.id}. Return to assignments and open the latest version.`);
        }
        if (current.status === "accepted") {
          conflict(`Assignment ${clean.id} is accepted and immutable.`);
        }
        const same = clean.status === current.status;
        if (!same && !TRANSITIONS[current.status].includes(clean.status)) {
          conflict(`Cannot move assignment from ${current.status} to ${clean.status}.`);
        }
        if (clean.status === "accepted") {
          if (clean.artifacts.length < 1 || clean.reviewNote === "") {
            const error = new Error(
              "Accepted assignments need at least one artifact and a nonempty review note.",
            );
            error.statusCode = 400;
            throw error;
          }
        }
        if (clean.status === "working" && current.status !== "working") {
          const working = state.assignments.filter(
            (item) => item.status === "working",
          ).length;
          if (working >= MAX_WORKING) {
            conflict("Maximum 3 working assignments at once. Finish or pause another assignment before starting this one.");
          }
        }
        const now = new Date().toISOString();
        const updated = {
          ...current,
          status: clean.status,
          summary: clean.summary,
          artifacts: [...clean.artifacts],
          reviewNote: clean.reviewNote,
          revision: current.revision + 1,
          updatedAt: now,
          history: [
            ...current.history,
            { at: now, status: clean.status, summary: clean.summary },
          ].slice(-MAX_HISTORY),
        };
        validateRecord(updated);
        const next = {
          version: 1,
          assignments: state.assignments.map((item) =>
            item.id === current.id ? updated : item,
          ),
        };
        await persist(next);
        state = next;
        return structuredClone(updated);
      });
    },
  };
}
