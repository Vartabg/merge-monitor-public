import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApi } from "../server/api.mjs";
import { createAssignmentStore } from "../server/assignments.mjs";
import { createBoardStore } from "../server/board.mjs";
import { createExecutionStore } from "../server/executions.mjs";

let folder, server, origin, token, assignments, board, executions, assignment;
const project = "Studio",
  agent = "worker",
  reviewer = "reviewer";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mm-team-api-"));
  assignments = await createAssignmentStore(join(folder, "assignments.json"));
  board = await createBoardStore(join(folder, "board.json"));
  executions = await createExecutionStore(join(folder, "executions.json"));
  for (const name of [agent, reviewer])
    await board.command("check-in", {
      project,
      agent: name,
      task: "Synthetic task",
      scope: "Fixture only",
      state: "working",
    });
  assignment = await assignments.create({
    title: "Review a bounded change",
    project,
    purpose: "Coordinate without relaying.",
    owner: agent,
    model: "synthetic",
    reviewer,
    scope: "Fixture only",
    acceptance: "Independent evidence returned",
    budget: "10 seconds",
  });
  const monitor = {
    repo: (id) => {
      if (id !== project)
        throw Object.assign(Error("Choose a configured project."), {
          statusCode: 404,
        });
    },
  };
  server = createServer(createApi(monitor, {}, assignments, board, executions));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(origin + "/api/session")).json()).token;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
});
const get = (path) => fetch(origin + path);
const post = (command, value, headers = {}) =>
  fetch(origin + "/api/team/" + command, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Merge-Monitor-Token": token,
      ...headers,
    },
    body: JSON.stringify(value),
  });
const claim = () => ({
  project,
  agent,
  assignmentId: assignment.id,
  requestId: randomUUID(),
});
it("exposes owned work, exclusively claims it, and delivers an idempotent addressed handoff", async () => {
  const inbox = await (
    await get("/api/team/inbox?project=Studio&agent=worker")
  ).json();
  expect(inbox.assignments.map((x) => x.id)).toEqual([assignment.id]);
  const input = claim(),
    response = await post("claim", input);
  expect(response.status).toBe(200);
  const run = await response.json();
  expect(run.phase).toBe("claimed");
  expect((await post("claim", input)).status).toBe(200);
  expect(assignments.list()[0].status).toBe("working");
  expect((await post("claim", claim())).status).toBe(409);
  const who = { project, agent, runId: run.runId };
  expect((await post("start", { ...who, adapter: "synthetic" })).status).toBe(
    200,
  );
  expect((await post("renew", who)).status).toBe(200);
  const result = {
    ...who,
    status: "review",
    summary: "Independent result is ready.",
    artifacts: ["/synthetic/result.json"],
    requestId: randomUUID(),
  };
  expect((await post("finish", result)).status).toBe(200);
  expect((await post("finish", result)).status).toBe(200);
  expect(assignments.list()[0].status).toBe("review");
  const reviewerInbox = await (
    await get("/api/team/inbox?project=Studio&agent=reviewer")
  ).json();
  expect(reviewerInbox.reviews[0].id).toBe(assignment.id);
  expect(
    reviewerInbox.requests.filter((x) => x.kind === "handoff"),
  ).toHaveLength(1);
  expect(reviewerInbox.requests[0].text).toContain(run.runId);
  expect(
    (await (await get("/api/team/runs?project=Studio")).json()).runs[0].phase,
  ).toBe("review");
});
it("rejects missing session, project/actor mismatch, unknown fields and unsupported methods", async () => {
  expect(
    (await post("claim", claim(), { "X-Merge-Monitor-Token": "" })).status,
  ).toBe(403);
  expect((await post("claim", { ...claim(), agent: "intruder" })).status).toBe(
    403,
  );
  expect((await post("claim", { ...claim(), project: "Other" })).status).toBe(
    404,
  );
  expect(
    (await post("claim", { ...claim(), command: "echo arbitrary" })).status,
  ).toBe(400);
  expect((await get("/api/team/claim")).status).toBe(405);
  expect(
    (await get("/api/team/inbox?project=Studio&agent=worker&agent=reviewer"))
      .status,
  ).toBe(400);
  expect((await get("/api/team/no-such-endpoint")).status).toBe(404);
  expect(executions.list(project)).toEqual([]);
});
it("cancels a claim without granting stale workers a completion path", async () => {
  const run = await (await post("claim", claim())).json(),
    who = { project, agent, runId: run.runId };
  expect(
    (await post("cancel", { ...who, summary: "Stopped before execution." }))
      .status,
  ).toBe(200);
  expect((await post("renew", who)).status).toBe(409);
  expect(
    (
      await post("finish", {
        ...who,
        status: "review",
        summary: "Late result.",
        artifacts: [],
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(409);
  expect(assignments.list()[0].status).toBe("blocked");
});

it("fences old terminal retries after a newer attempt owns the assignment", async () => {
  const first = await (await post("claim", claim())).json(),
    who = { project, agent, runId: first.runId };
  await post("start", { ...who, adapter: "synthetic" });
  const result = {
    ...who,
    status: "review",
    summary: "First result.",
    artifacts: [],
    requestId: randomUUID(),
  };
  expect((await post("finish", result)).status).toBe(200);
  for (const status of ["working", "blocked", "queued"]) {
    const current = assignments.list()[0];
    await assignments.update({
      id: current.id,
      revision: current.revision,
      status,
      summary: "Reviewer requested a new attempt.",
      artifacts: [],
      reviewNote: "",
    });
  }
  const second = await (await post("claim", claim())).json();
  await post("start", {
    project,
    agent,
    runId: second.runId,
    adapter: "synthetic",
  });
  expect((await post("finish", result)).status).toBe(409);
  expect(assignments.list()[0].status).toBe("working");
  expect(
    (await post("renew", { project, agent, runId: second.runId })).status,
  ).toBe(200);
});
