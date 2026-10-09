import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateStore } from "../server/state.mjs";
import { Monitor } from "../server/monitor.mjs";
import { createWorker } from "../server/worker.mjs";
import { repo, ready, response } from "./ui-fixtures";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "monitor-state-"));
  roots.push(root);
  const path = join(root, "state.json");
  const store = await createStateStore(path);
  const status = response().status;
  const monitor = new Monitor({ repos: [repo], defaultRepo: repo.id }, store, {
    inspect: vi.fn().mockResolvedValue(status),
    preview: vi.fn().mockResolvedValue(ready.preview),
  });
  return { path, store, monitor, worker: createWorker(monitor) };
}
it("serializes state updates and preserves history across restarts", async () => {
  const { path, monitor } = await setup();
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      monitor.record({
        repoId: "test",
        branch: `codex/${i}`,
        source: "manual",
        outcome: "clean",
        message: "Preview passed",
        headSha: "a",
        baseSha: "b",
      }),
    ),
  );
  expect((await createStateStore(path)).get().history).toHaveLength(10);
  expect(JSON.parse(await readFile(path, "utf8")).history).toHaveLength(10);
});
it("does not re-preview unchanged commits in consecutive worker cycles", async () => {
  const { store, monitor, worker } = await setup();
  await store.update((s) => ({ ...s, enabled: true }));
  await worker.run();
  await worker.run();
  expect(monitor.preview).toHaveBeenCalledTimes(1);
  expect(worker.view().lastRun).not.toBeNull();
  expect(store.get().history[0].source).toBe("worker");
  worker.stop();
});
it("continues after a repository failure and records the error", async () => {
  const { store, monitor, worker } = await setup();
  monitor.config.repos.push({ ...repo, id: "second", label: "Second repo" });
  monitor.inspect
    .mockRejectedValueOnce(new Error("Unavailable repo"))
    .mockResolvedValue({ ...response().status, repoId: "second" });
  await store.update((s) => ({ ...s, enabled: true }));
  await worker.run();
  expect(monitor.preview).toHaveBeenCalledTimes(1);
  expect(store.get().history.some((event) => event.outcome === "error")).toBe(
    true,
  );
  expect(worker.view().status).toBe("error");
  worker.stop();
});
it("never scans or previews while the worker is paused", async () => {
  const { monitor, worker } = await setup();
  await worker.run();
  expect(monitor.inspect).not.toHaveBeenCalled();
  expect(worker.view().status).toBe("paused");
  worker.stop();
});
