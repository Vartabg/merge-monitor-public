import { beforeEach, afterEach, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { publicationFixture, project } from "./publication-fixture.mjs";

let f;
beforeEach(async () => { f = await publicationFixture({ start: false }); });
afterEach(async () => { await f?.cleanup(); });

it("preserves later working edits on exact start retries after restart", async () => {
  const started = await f.start();
  expect(started.startAssignmentRevision).toBe(2);
  const edited = await f.update("working");
  await f.reopen();
  expect(await f.start()).toEqual(started);
  expect(f.assignments.list()[0]).toEqual(edited);
});
it("recovers a missing start queue write after restart", async () => {
  f.assignments.update = async () => { throw Error("Synthetic queue failure"); };
  await expect(f.start()).rejects.toThrow("Synthetic queue failure");
  expect(f.executions.list(project)[0]).toMatchObject({ phase: "running", startAssignmentRevision: 2 });
  expect(f.assignments.list()[0].revision).toBe(2);
  await f.reopen();
  await f.start();
  expect(f.assignments.list()[0].revision).toBe(3);
  await f.start();
  expect(f.assignments.list()[0].revision).toBe(3);
});
it("preserves a manual edit after a failed start queue write", async () => {
  const update = f.assignments.update;
  f.assignments.update = async () => { throw Error("Synthetic queue failure"); };
  await expect(f.start()).rejects.toThrow("Synthetic queue failure");
  f.assignments.update = update;
  const edited = await f.update("working");
  await f.reopen();
  await f.start();
  expect(f.assignments.list()[0]).toEqual(edited);
});
it("recovers a lost start queue response without another revision", async () => {
  const update = f.assignments.update;
  f.assignments.update = async input => { await update(input); throw Error("Synthetic lost response"); };
  await expect(f.start()).rejects.toThrow("Synthetic lost response");
  const saved = f.assignments.list()[0];
  await f.reopen();
  await f.start();
  expect(f.assignments.list()[0]).toEqual(saved);
});
it("does not rewrite legacy running records and rejects client publication fields", async () => {
  await f.start();
  const saved = JSON.parse(await readFile(f.paths.executions, "utf8"));
  delete saved.runs[0].startAssignmentRevision;
  await writeFile(f.paths.executions, JSON.stringify(saved));
  const edited = await f.update("working");
  await f.reopen();
  expect(await f.start()).not.toHaveProperty("startAssignmentRevision");
  expect(f.assignments.list()[0]).toEqual(edited);
  await expect(f.workflow.start({ ...f.who, adapter: "synthetic", startAssignmentRevision: 1 }))
    .rejects.toMatchObject({ statusCode: 400 });
});
