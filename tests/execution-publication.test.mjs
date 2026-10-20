import { beforeEach, afterEach, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { createExecutionStore } from "../server/executions.mjs";
import { publicationFixture, project } from "./publication-fixture.mjs";

let f;
beforeEach(async () => { f = await publicationFixture(); });
afterEach(async () => { await f?.cleanup(); });

it("saves the internal publication revision once and keeps it on durable exact retries", async () => {
  const finished = await f.executions.finish(f.input, 3);
  expect(finished.finishAssignmentRevision).toBe(3);
  expect(await f.executions.finish(f.input, 999)).toEqual(finished);
  await f.reopen();
  expect(await f.executions.finish(f.input, 999)).toEqual(finished);
});
it("rejects a client-supplied publication revision without finishing or changing the queue", async () => {
  await expect(f.workflow.finish({ ...f.input, finishAssignmentRevision: 1 }))
    .rejects.toMatchObject({ statusCode: 400 });
  expect(f.executions.list(project)[0].phase).toBe("running");
  expect(f.assignments.list()[0]).toMatchObject({ revision: 3, status: "working" });
});
it.each([0, -1, 1.5, null, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid internal publication revision %s", async revision => {
    await expect(f.executions.finish(f.input, revision)).rejects.toMatchObject({ statusCode: 400 });
    expect(f.executions.list(project)[0].phase).toBe("running");
  },
);
it("fails closed on corrupt saved publication markers and preserves the original bytes", async () => {
  await f.executions.finish(f.input, 3);
  const saved = JSON.parse(await readFile(f.paths.executions, "utf8"));
  for (const marker of [0, null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    saved.runs[0].finishAssignmentRevision = marker;
    const bytes = JSON.stringify(saved);
    await writeFile(f.paths.executions, bytes);
    await expect(createExecutionStore(f.paths.executions)).rejects.toThrow();
    expect(await readFile(f.paths.executions, "utf8")).toBe(bytes);
  }
});
it("rejects a saved publication marker on an unfinished run", async () => {
  const saved = JSON.parse(await readFile(f.paths.executions, "utf8"));
  saved.runs[0].finishAssignmentRevision = 3;
  await writeFile(f.paths.executions, JSON.stringify(saved));
  await expect(createExecutionStore(f.paths.executions)).rejects.toThrow();
});
it("does not save a first finish over an already accepted assignment", async () => {
  await f.update("review");
  const accepted = await f.update("accepted");
  await expect(f.workflow.finish(f.input)).rejects.toMatchObject({ statusCode: 409 });
  expect(f.executions.list(project)[0].phase).toBe("running");
  expect(f.assignments.list()[0]).toEqual(accepted);
});
