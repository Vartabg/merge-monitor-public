import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, lstat, chmod, symlink, link, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateStateFile } from "../server/private-state-file.mjs";
import { createStateStore } from "../server/state.mjs";
import { createAssignmentStore } from "../server/assignments.mjs";
import { createBoardStore } from "../server/board.mjs";
import { executionFile } from "../server/execution-file.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "private-state-"));
  roots.push(root);
  return { root, path: join(root, "state.json") };
}
const value = { version: 1, note: "Keep private work" };
it("opens existing private JSON unchanged and atomically replaces it with owner-only permissions", async () => {
  const { root, path } = await fixture();
  const bytes = JSON.stringify(value);
  await writeFile(path, bytes, { mode: 0o600 });
  const file = await privateStateFile(path);
  expect(await file.read()).toEqual(value);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await file.save({ ...value, note: "Updated work" });
  expect(await file.read()).toEqual({ ...value, note: "Updated work" });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  expect(await readdir(root)).toEqual(["state.json"]);
});
it("creates missing private parents but refuses existing shared or symlink parents without chmod", async () => {
  const { root } = await fixture(), directory = join(root, "private");
  const file = await privateStateFile(join(directory, "state.json"));
  await file.save(value);
  await chmod(directory, 0o750);
  await expect(privateStateFile(join(directory, "state.json"))).rejects.toThrow(/private/);
  await expect(file.save(value)).rejects.toThrow(/private/);
  expect((await stat(directory)).mode & 0o777).toBe(0o750);
  await chmod(directory, 0o700);
  const alias = join(root, "alias");
  await symlink(directory, alias);
  await expect(privateStateFile(join(alias, "state.json"))).rejects.toThrow(/nonsymlink/);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
});
it.each(["symlink", "hardlink", "public"])("refuses %s targets on read and save without changing their bytes", async kind => {
  const { root, path } = await fixture();
  const file = await privateStateFile(path), original = join(root, "original.json");
  const bytes = JSON.stringify(value);
  await writeFile(original, bytes, { mode: 0o600 });
  if (kind === "symlink") await symlink(original, path);
  if (kind === "hardlink") await link(original, path);
  if (kind === "public") await writeFile(path, bytes, { mode: 0o644 });
  await expect(file.read()).rejects.toThrow(/private/);
  await expect(file.save({ changed: true })).rejects.toThrow(/private/);
  expect(await readFile(original, "utf8")).toBe(bytes);
  expect(await readFile(path, "utf8")).toBe(bytes);
});
it.each(["symlink", "directory", "file"])("refuses an exclusive temporary %s collision and never removes it", async kind => {
  const { root, path } = await fixture(), id = "11111111-1111-4111-8111-111111111111";
  const file = await privateStateFile(path, { temporaryId: () => id });
  await file.save(value);
  const temporary = `${path}.${id}.tmp`, victim = join(root, "unrelated.txt");
  await writeFile(victim, "Unrelated private data", { mode: 0o600 });
  if (kind === "symlink") await symlink(victim, temporary);
  if (kind === "directory") await mkdir(temporary);
  if (kind === "file") await writeFile(temporary, "Stale evidence", { mode: 0o600 });
  await expect(file.save({ changed: true })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await file.read()).toEqual(value);
  expect(await readFile(victim, "utf8")).toBe("Unrelated private data");
  expect(await lstat(temporary)).toBeDefined();
  await rm(temporary, { recursive: true });
  await file.save({ recovered: true });
  expect(await file.read()).toEqual({ recovered: true });
});
it("bounds both reads and writes and keeps the last valid saved bytes", async () => {
  const { path } = await fixture(), file = await privateStateFile(path, { maxBytes: 64 });
  await file.save(value);
  const bytes = await readFile(path, "utf8");
  await expect(file.save({ note: "x".repeat(100) })).rejects.toThrow(/size limit/);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await writeFile(path, "x".repeat(65));
  await expect(file.read()).rejects.toThrow(/bounded private/);
  expect(await readFile(path, "utf8")).toBe("x".repeat(65));
});
const assignment = { title: "Preserve work", project: "studio", purpose: "Safe state", owner: "worker", model: "native", reviewer: "reviewer", scope: "State", acceptance: "Persists", budget: "No provider" };
const checkin = { project: "studio", agent: "worker", task: "Safe state", scope: "State", state: "working" };
const stores = [
  ["monitor", createStateStore, store => store.update(state => ({ ...state, enabled: true })), store => store.get()],
  ["assignments", createAssignmentStore, store => store.create(assignment), store => store.list()],
  ["board", createBoardStore, store => store.command("check-in", checkin), store => store.view("studio").room],
];
it.each(stores)("%s ignores the old predictable symlink and preserves memory across unsafe-directory failure", async (name, create, update, view) => {
  const { root, path } = await fixture(), victim = join(root, "unrelated.txt");
  await writeFile(victim, "Must remain unchanged", { mode: 0o600 });
  const oldTemporary = `${path}.${process.pid}.tmp`;
  await symlink(victim, oldTemporary);
  const store = await create(path);
  await update(store);
  const original = view(store), bytes = await readFile(path, "utf8");
  expect((await lstat(path)).isSymbolicLink()).toBe(false);
  expect(await readFile(victim, "utf8")).toBe("Must remain unchanged");
  expect((await lstat(oldTemporary)).isSymbolicLink()).toBe(true);
  await chmod(root, 0o750);
  await expect(update(store)).rejects.toThrow();
  expect(view(store)).toEqual(original);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await chmod(root, 0o700);
  await update(store);
  expect(view(await create(path))).toEqual(view(store));
});
it.each([
  ["monitor", createStateStore, { version: 1, enabled: false, history: [], taskContexts: [] }],
  ["assignments", createAssignmentStore, { version: 1, assignments: [] }],
  ["board", createBoardStore, { version: 1, rooms: [] }],
  ["execution", executionFile, { version: 1, runs: [] }],
])("%s preserves valid existing private state and refuses a symlink migration", async (name, create, saved) => {
  const { root, path } = await fixture(), bytes = JSON.stringify(saved);
  await writeFile(path, bytes, { mode: 0o600 });
  await create(path);
  expect(await readFile(path, "utf8")).toBe(bytes);
  const alias = join(root, "alias.json");
  await symlink(path, alias);
  await expect(create(alias)).rejects.toThrow(/private/);
  expect(await readFile(path, "utf8")).toBe(bytes);
});
