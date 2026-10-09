import { createBoardStore } from "./board.mjs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";
import { createStateStore } from "./state.mjs";
import { Monitor } from "./monitor.mjs";
import { createWorker } from "./worker.mjs";
import { createApi } from "./api.mjs";
import { createAssignmentStore } from "./assignments.mjs";

export async function createService(
  root,
  {
    statePath = process.env.MERGE_MONITOR_STATE ||
      resolve(homedir(), ".local/share/merge-monitor/state.json"),
    startWorker = true,
  } = {},
) {
  const config = await loadConfig(root);
  const store = await createStateStore(statePath);
  const assignments = await createAssignmentStore(
    `${statePath}.assignments.json`,
  );
  const board = await createBoardStore(`${statePath}.board.json`);
  const monitor = new Monitor(config, store);
  const worker = createWorker(monitor);
  if (startWorker) worker.start();
  return {
    monitor,
    worker,
    assignments,
    board,
    api: createApi(monitor, worker, assignments, board),
    close: () => worker.stop(),
  };
}
