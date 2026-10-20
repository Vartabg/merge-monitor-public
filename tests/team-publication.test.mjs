import { afterEach, beforeEach, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { publicationFixture, project, agent } from "./publication-fixture.mjs";

let f;
beforeEach(async () => { f = await publicationFixture(); });
afterEach(async () => { await f?.cleanup(); });

it.each(["working", "review", "blocked", "accepted", "queued"])(
  "preserves a later reviewer %s decision on exact finish retries after restart", async status => {
    const finished = await f.workflow.finish(f.input);
    expect(finished.finishAssignmentRevision).toBe(3);
    const edited = await f.update(status);
    await f.reopen();
    expect(await f.workflow.finish(f.input)).toEqual(finished);
    expect(await f.workflow.finish(f.input)).toEqual(finished);
    expect(f.assignments.list()[0]).toEqual(edited);
    expect(f.handoffs()).toHaveLength(1);
  },
);
it("publishes final evidence even when an operator already selected review", async () => {
  const preliminary = await f.update("review");
  const result = await f.workflow.finish(f.input);
  expect(result.finishAssignmentRevision).toBe(preliminary.revision);
  expect(f.assignments.list()[0]).toMatchObject({ revision: preliminary.revision + 1,
    status: "review", summary: f.input.summary, artifacts: f.input.artifacts, reviewNote: "" });
  expect(f.handoffs()).toHaveLength(1);
});
it("recovers missing assignment publication after a write failure and restart", async () => {
  f.assignments.update = async () => { throw Error("Synthetic write failure"); };
  await expect(f.workflow.finish(f.input)).rejects.toThrow("Synthetic write failure");
  expect(f.executions.list(project)[0]).toMatchObject({ phase: "review", finishAssignmentRevision: 3 });
  expect(f.assignments.list()[0]).toMatchObject({ status: "working", revision: 3 });
  await f.reopen();
  await f.workflow.finish(f.input);
  expect(f.assignments.list()[0]).toMatchObject({ status: "review", revision: 4, artifacts: f.input.artifacts });
  expect(f.handoffs()).toHaveLength(1);
});
it("does not overwrite an edit made after a failed assignment publication", async () => {
  const original = f.assignments.update;
  f.assignments.update = async () => { throw Error("Synthetic write failure"); };
  await expect(f.workflow.finish(f.input)).rejects.toThrow("Synthetic write failure");
  f.assignments.update = original;
  const edited = await f.update("working");
  await f.reopen();
  await f.workflow.finish(f.input);
  expect(f.assignments.list()[0]).toEqual(edited);
  expect(f.handoffs()).toHaveLength(1);
});
it("recovers a lost assignment-write response without an extra queue revision", async () => {
  const update = f.assignments.update;
  f.assignments.update = async input => { await update(input); throw Error("Synthetic lost response"); };
  await expect(f.workflow.finish(f.input)).rejects.toThrow("Synthetic lost response");
  const saved = f.assignments.list()[0];
  await f.reopen();
  await f.workflow.finish(f.input);
  expect(f.assignments.list()[0]).toEqual(saved);
  expect(f.handoffs()).toHaveLength(1);
});
it("recovers a lost handoff response after restart without duplicating delivery", async () => {
  const command = f.board.command;
  f.board.command = async (...args) => { await command(...args); throw Error("Synthetic lost response"); };
  await expect(f.workflow.finish(f.input)).rejects.toMatchObject({ statusCode: 503 });
  const saved = f.assignments.list()[0];
  expect(f.handoffs()).toHaveLength(1);
  await f.reopen();
  await f.workflow.finish(f.input);
  expect(f.assignments.list()[0]).toEqual(saved);
  expect(f.handoffs()).toHaveLength(1);
});
it("delivers a missing handoff after later review edits without replacing them", async () => {
  f.board.command = async () => { throw Error("Synthetic handoff failure"); };
  await expect(f.workflow.finish(f.input)).rejects.toMatchObject({ statusCode: 503 });
  await f.reopen();
  const edited = await f.update("accepted");
  await f.reopen();
  await f.workflow.finish(f.input);
  expect(f.assignments.list()[0]).toEqual(edited);
  expect(f.handoffs()).toHaveLength(1);
});
it("never rewrites legacy finished records' queue state after restart", async () => {
  await f.workflow.finish(f.input);
  const state = JSON.parse(await readFile(f.paths.executions, "utf8"));
  delete state.runs[0].finishAssignmentRevision;
  await writeFile(f.paths.executions, JSON.stringify(state));
  const edited = await f.update("working");
  await f.reopen();
  const result = await f.workflow.finish(f.input);
  expect(result).not.toHaveProperty("finishAssignmentRevision");
  expect(f.assignments.list()[0]).toEqual(edited);
  expect(f.handoffs()).toHaveLength(1);
});
it("queues reviewer corrections directly and fences the earlier result after a new claim", async () => {
  await f.workflow.finish(f.input);
  const queued = await f.update("queued");
  const inbox = f.workflow.inbox({ project, agent });
  expect(inbox.assignments).toEqual([queued]);
  const replacement = await f.claim();
  expect(replacement.runId).not.toBe(f.who.runId);
  expect(f.assignments.list()[0]).toMatchObject({ status: "working",
    artifacts: queued.artifacts, reviewNote: queued.reviewNote });
  await f.workflow.start({ project, agent, runId: replacement.runId, adapter: "synthetic" });
  const working = f.assignments.list()[0];
  expect(working).toMatchObject({ artifacts: queued.artifacts, reviewNote: queued.reviewNote });
  await expect(f.workflow.finish(f.input)).rejects.toMatchObject({ statusCode: 409 });
  expect(f.assignments.list()[0]).toEqual(working);
});
