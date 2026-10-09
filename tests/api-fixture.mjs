import { afterEach, beforeEach, vi } from "vitest";
import { createServer } from "node:http";
import { createApi } from "../server/api.mjs";
import { Monitor } from "../server/monitor.mjs";
import { createWorker } from "../server/worker.mjs";
import { response, ready, repo } from "./ui-fixtures";

let server, token, worker;
export let origin, monitor, state;
beforeEach(async () => {
  state = { version: 1, enabled: false, history: [] };
  const store = {
    get: () => structuredClone(state),
    update: async (fn) => {
      state = fn(state);
      return structuredClone(state);
    },
  };
  const status = response().status;
  monitor = new Monitor({ repos: [repo], defaultRepo: repo.id }, store, {
    inspect: vi.fn().mockResolvedValue(status),
    preview: vi.fn().mockResolvedValue(ready.preview),
  });
  worker = createWorker(monitor);
  server = createServer(createApi(monitor, worker));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(`${origin}/api/session`)).json()).token;
});
afterEach(async () => {
  worker.stop();
  await monitor.scanTail;
  await new Promise((resolve) => server.close(resolve));
});
export const post = (path, value, headers = {}) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Merge-Monitor-Token": token,
      ...headers,
    },
    body: JSON.stringify(value),
  });
