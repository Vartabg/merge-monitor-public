import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, stat, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssignmentStore } from "../server/assignments.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "queue-durability-"));
  roots.push(root);
  const path = join(root, "queue.json");
  const store = await createAssignmentStore(path);
  const item = await store.create({
    title: "Durability",
    project: "Studio",
    purpose: "Preserve work",
    owner: "Muse",
    model: "Muse 1.3",
    reviewer: "Codex",
    scope: "Store",
    acceptance: "Restart succeeds",
    budget: "8 steps",
  });
  return { root, path, store, item };
}
const update = (item) => ({
  id: item.id,
  revision: item.revision,
  status: "working",
  summary: "Progress",
  artifacts: [],
  reviewNote: "",
});
it("continues saving and reopening after the first history event rolls off", async () => {
  const { store, path, item } = await setup();
  let current = item;
  for (let index = 0; index < 55; index++)
    current = await store.update(update(current));
  expect(current.history).toHaveLength(50);
  expect(current.revision).toBe(56);
  expect((await createAssignmentStore(path)).list()[0]).toEqual(current);
});
it("preserves an existing parent folder's permissions", async () => {
  const { root, store } = await setup();
  await chmod(root, 0o750);
  const item = store.list()[0];
  await store.update(update(item));
  expect((await stat(root)).mode & 0o777).toBe(0o750);
});
it("keeps memory and saved data unchanged on an actual persistence failure, then recovers", async () => {
  const { store, path, item } = await setup();
  const bytes = await readFile(path, "utf8");
  const obstacle = `${path}.${process.pid}.tmp`;
  await mkdir(obstacle);
  await expect(store.update(update(item))).rejects.toThrow();
  expect(store.list()).toEqual([item]);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await rm(obstacle, { recursive: true });
  expect((await store.update(update(item))).revision).toBe(2);
});

it("accepts CRLF multiline notes from a Windows-authored CLI input file", async () => {
  const { store, item, path } = await setup();
  const saved = await store.update({ ...update(item), summary: "First line\r\nSecond line", reviewNote: "Check one\r\nCheck two" });
  expect(saved.summary).toBe("First line\nSecond line");
  expect(saved.reviewNote).toBe("Check one\nCheck two");
  expect((await createAssignmentStore(path)).list()[0]).toEqual(saved);
});
