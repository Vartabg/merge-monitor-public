import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { publicationFixture, project, agent } from "./publication-fixture.mjs";

let f;
beforeEach(async () => { f = await publicationFixture({ claim: false }); });
afterEach(async () => { await f?.cleanup(); });
const input = () => ({ project, agent, assignmentId: f.assignment.id, requestId: randomUUID() });

it("recovers a missing claim queue write after restart using its original revision", async () => {
  const request = input();
  const run = await f.executions.claim(request, f.assignment);
  expect(f.assignments.list()[0]).toMatchObject({ status: "queued", revision: 1 });
  await f.reopen();
  expect(await f.workflow.claim(request)).toEqual(run);
  expect(f.assignments.list()[0]).toMatchObject({ status: "working", revision: 2 });
  await f.reopen();
  expect(await f.workflow.claim(request)).toEqual(run);
  expect(f.assignments.list()[0].revision).toBe(2);
});
it("rejects an old claim replay after a reviewer blocks and requeues without erasing findings", async () => {
  const request = input(), run = await f.workflow.claim(request);
  await f.update("blocked");
  const queued = await f.update("queued");
  await f.reopen();
  await expect(f.workflow.claim(request)).rejects.toMatchObject({ statusCode: 409 });
  expect(f.assignments.list()[0]).toEqual(queued);
  expect(f.executions.list(project)[0]).toEqual(run);
  await expect(f.claim()).rejects.toMatchObject({ statusCode: 409 });
  await f.workflow.cancel({ project, agent, runId: run.runId,
    summary: "Confirmed the original claimed worker never started." });
  const replacement = await f.claim();
  expect(replacement.runId).not.toBe(run.runId);
  expect(f.assignments.list()[0]).toMatchObject({ status: "working", artifacts: queued.artifacts,
    reviewNote: queued.reviewNote });
});
it("preserves a later working edit on an otherwise successful exact claim retry", async () => {
  const request = input(), run = await f.workflow.claim(request);
  const edited = await f.update("working");
  await f.reopen();
  expect(await f.workflow.claim(request)).toEqual(run);
  expect(f.assignments.list()[0]).toEqual(edited);
});
it("preserves correction evidence through claim, start and progress-only cleanup", async () => {
  await f.update("blocked");
  const queued = await f.update("queued");
  const run = await f.claim();
  const who = { project, agent, runId: run.runId };
  expect(f.assignments.list()[0]).toMatchObject({ artifacts: queued.artifacts, reviewNote: queued.reviewNote });
  await f.workflow.start({ ...who, adapter: "synthetic" });
  expect(f.assignments.list()[0]).toMatchObject({ artifacts: queued.artifacts, reviewNote: queued.reviewNote });
  await f.workflow.abandon({ ...who, summary: "Cleanup requires investigation." });
  expect(f.assignments.list()[0]).toMatchObject({ artifacts: queued.artifacts, reviewNote: queued.reviewNote });
});
it("replaces prior correction evidence only when the new attempt finishes", async () => {
  await f.update("blocked");
  await f.update("queued");
  const run = await f.claim(), who = { project, agent, runId: run.runId };
  await f.workflow.start({ ...who, adapter: "synthetic" });
  await f.workflow.finish({ ...who, status: "review", summary: "Corrections verified.",
    artifacts: ["/synthetic/new-result.md"], requestId: randomUUID() });
  expect(f.assignments.list()[0]).toMatchObject({ status: "review",
    artifacts: ["/synthetic/new-result.md"], reviewNote: "" });
});
