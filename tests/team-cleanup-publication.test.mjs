import { beforeEach, afterEach, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { publicationFixture, project } from "./publication-fixture.mjs";

let f;
beforeEach(async () => { f = await publicationFixture(); });
afterEach(async () => { await f?.cleanup(); });
const report = () => ({ ...f.who, summary: "Cleanup report with independent stop evidence." });
const messages = () => f.board.view(project).room.messages;

it.each(["cancel", "abandon"])("%s retries preserve later reviewer edits after restart", async command => {
  const input = report(), result = await f.workflow[command](input);
  expect(result.cleanupAssignmentRevision).toBe(3);
  expect(f.assignments.list()[0]).toMatchObject({ status: "blocked", revision: 4 });
  const edited = await f.update("working");
  await f.reopen();
  expect(await f.workflow[command](input)).toEqual(result);
  expect(f.assignments.list()[0]).toEqual(edited);
  expect(messages()).toHaveLength(1);
});
it.each(["cancel", "abandon"])("%s recovers missing queue publication after restart", async command => {
  f.assignments.update = async () => { throw Error("Synthetic queue failure"); };
  const input = report();
  await expect(f.workflow[command](input)).rejects.toThrow("Synthetic queue failure");
  expect(f.executions.list(project)[0].cleanupAssignmentRevision).toBe(3);
  expect(f.assignments.list()[0]).toMatchObject({ revision: 3, status: "working" });
  await f.reopen();
  await f.workflow[command](input);
  expect(f.assignments.list()[0]).toMatchObject({ revision: 4, status: "blocked" });
  expect(messages()).toHaveLength(1);
});
it.each(["cancel", "abandon"])("%s recovers lost queue and handoff responses idempotently", async command => {
  const input = report(), update = f.assignments.update;
  f.assignments.update = async value => { await update(value); throw Error("Synthetic lost queue response"); };
  await expect(f.workflow[command](input)).rejects.toThrow("Synthetic lost queue response");
  const saved = f.assignments.list()[0];
  await f.reopen();
  const post = f.board.command;
  f.board.command = async (...args) => { await post(...args); throw Error("Synthetic lost handoff response"); };
  await expect(f.workflow[command](input)).rejects.toMatchObject({ statusCode: 503 });
  await f.reopen();
  await f.workflow[command](input);
  expect(f.assignments.list()[0]).toEqual(saved);
  expect(messages()).toHaveLength(1);
});
it.each(["cancel", "abandon"])("%s never rewrites legacy terminal queue state", async command => {
  const input = report();
  await f.workflow[command](input);
  const saved = JSON.parse(await readFile(f.paths.executions, "utf8"));
  delete saved.runs[0].cleanupAssignmentRevision;
  await writeFile(f.paths.executions, JSON.stringify(saved));
  const edited = await f.update("working");
  await f.reopen();
  expect(await f.workflow[command](input)).not.toHaveProperty("cleanupAssignmentRevision");
  expect(f.assignments.list()[0]).toEqual(edited);
  await expect(f.workflow[command]({ ...input, cleanupAssignmentRevision: 1 }))
    .rejects.toMatchObject({ statusCode: 400 });
});
it("records a fresh cancel publication after uncertain abandonment and preserves its retry", async () => {
  const abandoned = await f.workflow.abandon({ ...f.who, summary: "Descendant status unknown." });
  expect(abandoned).toMatchObject({ phase: "expired", cleanupAssignmentRevision: 3 });
  await f.update("working");
  const input = { ...f.who, summary: "Independent check confirmed all owned work stopped." };
  f.assignments.update = async () => { throw Error("Synthetic cancel queue failure"); };
  await expect(f.workflow.cancel(input)).rejects.toThrow("Synthetic cancel queue failure");
  expect(f.executions.list(project)[0]).toMatchObject({ phase: "cancelled", cleanupAssignmentRevision: 5 });
  await f.reopen();
  const cancelled = await f.workflow.cancel(input);
  expect(f.assignments.list()[0]).toMatchObject({ status: "blocked", revision: 6 });
  const edited = await f.update("working");
  await f.reopen();
  expect(await f.workflow.cancel(input)).toEqual(cancelled);
  expect(f.assignments.list()[0]).toEqual(edited);
  expect(messages()).toHaveLength(2);
  await expect(f.workflow.abandon({ ...f.who, summary: "Descendant status unknown." }))
    .rejects.toMatchObject({ statusCode: 409 });
});
it.each(["cancel", "abandon"])("%s retries preserve accepted work while delivering a missing handoff", async command => {
  const input = report();
  f.board.command = async () => { throw Error("Synthetic handoff failure"); };
  await expect(f.workflow[command](input)).rejects.toMatchObject({ statusCode: 503 });
  await f.reopen();
  await f.update("working");
  await f.update("review");
  const accepted = await f.update("accepted");
  await f.reopen();
  await f.workflow[command](input);
  expect(f.assignments.list()[0]).toEqual(accepted);
  expect(messages()).toHaveLength(1);
});
