import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, inboxCursor, loadState, pendingClaims, validateConfig } from "../scripts/dispatch.mjs";

let folder;
afterEach(async () => { if (folder) await rm(folder, { recursive: true, force: true }); folder = undefined; });

const agent = { boardAgent: "op-helper", project: "example", harness: "opencode", cwd: "/Users/test/x" };
const config = validateConfig({ agents: [agent], claimDeadlineSeconds: 60 });
const key = "example:op-helper:a-1@1";
const inboxWith = status => new Map([["example:op-helper", { assignments: [{ id: "a-1", status }] }]]);

it("validates the pass-1 knobs with defaults", () => {
  const c = validateConfig({ agents: [agent] });
  expect(c.claimDeadlineSeconds).toBe(300); expect(c.maxWakesPerCycle).toBe(2); expect(c.dispatcherAgent).toBe("board-dispatcher");
  expect(() => validateConfig({ agents: [agent], claimDeadlineSeconds: 5 })).toThrow(/claimDeadlineSeconds/);
});

it("escalates only still-queued wakes past the deadline, and marks moved-on work claimed", () => {
  const state = { wakes: { [key]: { at: new Date(0).toISOString(), claimed: false, escalated: false } } };
  expect(pendingClaims(config, inboxWith("queued"), state, 61_000).map(p => p.id)).toEqual(["a-1"]);
  expect(pendingClaims(config, inboxWith("queued"), state, 30_000)).toHaveLength(0); // inside deadline
  const state2 = { wakes: { [key]: { at: new Date(0).toISOString(), claimed: false, escalated: false } } };
  expect(pendingClaims(config, inboxWith("review"), state2, 61_000)).toHaveLength(0);
  expect(state2.wakes[key].claimed).toBe(true); // worked work never escalates
});

it("migrates v1 wake strings and holds one live lock", async () => {
  folder = await mkdtemp(join(tmpdir(), "dispatch-"));
  const statePath = join(folder, "state.json");
  await writeFile(statePath, JSON.stringify({ wakes: { [key]: new Date(0).toISOString() } }), { mode: 0o600 });
  expect((await loadState(statePath)).wakes[key]).toEqual({ at: new Date(0).toISOString(), claimed: false, escalated: false });

  const lockPath = join(folder, "lock");
  const release = await acquireLock(lockPath, 111, () => true);
  await expect(acquireLock(lockPath, 222, () => true)).rejects.toThrow(/Another dispatcher/);
  await release();
  const release2 = await acquireLock(lockPath, 222, () => false); // stale owner is replaced
  await release2();
  expect(inboxCursor({ a: 1 })).toBe(inboxCursor({ a: 1 }));
  expect(inboxCursor({ a: 1 })).not.toBe(inboxCursor({ a: 2 }));
  await readFile(lockPath, "utf8").catch(() => "gone");
});
