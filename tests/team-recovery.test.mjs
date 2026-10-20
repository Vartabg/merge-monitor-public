import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAssignmentStore } from "../server/assignments.mjs";
import { createExecutionStore } from "../server/executions.mjs";
import { createBoardStore } from "../server/board.mjs";
import { createTeamWorkflow } from "../server/team-workflow.mjs";

let folder, assignments, executions, board, workflow, assignment, who;
const project = "Studio",
  agent = "worker",
  reviewer = "reviewer";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mm-team-recovery-"));
  assignments = await createAssignmentStore(join(folder, "assignments.json"));
  executions = await createExecutionStore(join(folder, "runtime", "runs.json"));
  board = await createBoardStore(join(folder, "board.json"));
  for (const name of [agent, reviewer])
    await board.command("check-in", {
      project,
      agent: name,
      task: "Recovery test",
      scope: "Synthetic only",
      state: "working",
    });
  assignment = await assignments.create({
    title: "Retry publication",
    project,
    purpose: "Keep results",
    owner: agent,
    reviewer,
    model: "synthetic",
    scope: "Fixture",
    acceptance: "Exact retry succeeds",
    budget: "10 seconds",
  });
  workflow = createTeamWorkflow({
    monitor: { repo: () => {} },
    assignments,
    executions,
    board,
  });
  const run = await workflow.claim({
    project,
    agent,
    assignmentId: assignment.id,
    requestId: randomUUID(),
  });
  who = { project, agent, runId: run.runId };
  await workflow.start({ ...who, adapter: "synthetic" });
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});
const result = () => ({
  ...who,
  status: "review",
  summary: "Saved independently verifiable result.",
  artifacts: ["/synthetic/evidence.json"],
  requestId: randomUUID(),
});
it("retries a saved finish after handoff publication fails, without rerunning work", async () => {
  const command = board.command;
  let failOnce = true;
  board.command = async (...args) => {
    if (args[0] === "post" && failOnce) {
      failOnce = false;
      throw Error("Synthetic disk failure");
    }
    return command(...args);
  };
  const input = result();
  await expect(workflow.finish(input)).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(executions.list(project)[0].phase).toBe("review");
  expect(assignments.list()[0].status).toBe("review");
  await workflow.finish(input);
  await workflow.finish(input);
  expect(
    board.view(project).room.messages.filter((item) => item.kind === "handoff"),
  ).toHaveLength(1);
  expect(executions.list(project)).toHaveLength(1);
});
it("preserves a saved result across assignment write failure and exact retry", async () => {
  const update = assignments.update;
  let failOnce = true;
  assignments.update = async (input) => {
    if (failOnce) {
      failOnce = false;
      throw Error("Synthetic queue write failure");
    }
    return update(input);
  };
  const input = result();
  await expect(workflow.finish(input)).rejects.toThrow(
    "Synthetic queue write failure",
  );
  expect(executions.list(project)[0].phase).toBe("review");
  expect(assignments.list()[0].status).toBe("working");
  await workflow.finish(input);
  expect(assignments.list()[0].status).toBe("review");
  expect(
    board.view(project).room.messages.filter((item) => item.kind === "handoff"),
  ).toHaveLength(1);
});
it("keeps uncertain cleanup reserved until explicit cancellation after stopping", async () => {
  const input = {
    ...who,
    summary: "Owned parent reaped; detached descendant status unknown.",
  };
  await workflow.abandon(input);
  await workflow.abandon(input);
  expect(assignments.list()[0].status).toBe("blocked");
  expect(executions.list(project)[0].phase).toBe("expired");
  const current = assignments.list()[0];
  await assignments.update({
    id: current.id,
    revision: current.revision,
    status: "queued",
    summary: "Investigating",
    artifacts: [],
    reviewNote: "",
  });
  await expect(
    workflow.claim({
      project,
      agent,
      assignmentId: current.id,
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await workflow.cancel({
    ...who,
    summary: "Confirmed all owned work stopped.",
  });
  const replacement = await workflow.claim({
    project,
    agent,
    assignmentId: current.id,
    requestId: randomUUID(),
  });
  expect(replacement.runId).not.toBe(who.runId);
});
