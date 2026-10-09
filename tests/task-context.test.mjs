import { expect, it } from "vitest";
import { saveTaskContext } from "../server/task-context.mjs";
import { createStateStore } from "../server/state.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { response, ready } from "./ui-fixtures";

it("migrates old state and preserves task context alongside worker updates across restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "monitor-context-"));
  try {
    const path = join(root, "state.json");
    await writeFile(
      path,
      JSON.stringify({ version: 1, enabled: true, history: [] }),
    );
    const store = await createStateStore(path);
    const monitor = { store, refresh: async () => response().status };
    const note = {
      repoId: "test",
      path: ready.path,
      branch: ready.branch,
      title: "Improve search",
      purpose: "Help readers find a passage.",
      owner: "Search task in Codex",
    };
    await saveTaskContext(monitor, note);
    await store.update((s) => ({ ...s, history: [{ id: "event" }] }));
    await saveTaskContext(monitor, { ...note, owner: "Reader task" });
    const restarted = (await createStateStore(path)).get();
    expect(restarted.enabled).toBe(true);
    expect(restarted.history).toHaveLength(1);
    expect(restarted.taskContexts).toHaveLength(1);
    expect(restarted.taskContexts[0]).toMatchObject({
      ...note,
      owner: "Reader task",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
