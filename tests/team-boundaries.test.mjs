import { beforeEach, afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import { createApi } from "../server/api.mjs";
import { createAssignmentStore } from "../server/assignments.mjs";
import { createExecutionStore } from "../server/executions.mjs";
import { createBoardStore } from "../server/board.mjs";
import { contract } from "../server/contract.mjs";

let folder, server, origin, token, assignments, assignment;
const project = "Studio",
  agent = "worker",
  reviewer = "reviewer";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mm-team-boundaries-"));
  assignments = await createAssignmentStore(join(folder, "assignments.json"));
  const executions = await createExecutionStore(
    join(folder, "runtime", "runs.json"),
  );
  const board = await createBoardStore(join(folder, "board.json"));
  for (const name of [agent, reviewer])
    await board.command("check-in", {
      project,
      agent: name,
      task: "Boundary test",
      scope: "Synthetic only",
      state: "working",
    });
  assignment = await assignments.create({
    title: "Bounded work",
    project,
    purpose: "Verify boundaries",
    owner: agent,
    reviewer,
    model: "synthetic",
    scope: "Fixture",
    acceptance: "Schema valid",
    budget: "No provider",
  });
  const monitor = {
    repo(id) {
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
const post = (command, input) =>
  fetch(origin + "/api/team/" + command, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Merge-Monitor-Token": token,
    },
    body: JSON.stringify(input),
  });
async function schema(response, name, status = 200) {
  expect(response.status).toBe(status);
  const value = await response.json();
  const validate = new Ajv({ strict: false }).compile({
    ...contract.components.schemas[name],
    components: contract.components,
  });
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  return value;
}
it("returns schema-valid read errors and an HTTP abandon result that retains its reservation", async () => {
  await schema(
    await fetch(
      origin + "/api/team/inbox?project=Studio&agent=" + "a".repeat(81),
    ),
    "Error",
    400,
  );
  await schema(
    await fetch(origin + "/api/team/runs?project=Other"),
    "Error",
    404,
  );
  await schema(
    await fetch(origin + "/api/team/inbox?project=Studio&agent=worker"),
    "TeamInbox",
  );
  const claimInput = {
    project,
    agent,
    assignmentId: assignment.id,
    requestId: randomUUID(),
  };
  const run = await schema(await post("claim", claimInput), "TeamRun"),
    who = { project, agent, runId: run.runId };
  await schema(
    await post("start", { ...who, adapter: "synthetic" }),
    "TeamRun",
  );
  const input = { ...who, summary: "Descendant cannot be confirmed stopped." };
  const abandoned = await schema(await post("abandon", input), "TeamRun");
  expect(abandoned.phase).toBe("expired");
  expect(await schema(await post("abandon", input), "TeamRun")).toEqual(
    abandoned,
  );
  expect(assignments.list()[0].status).toBe("blocked");
  const runs = await schema(
    await fetch(origin + "/api/team/runs?project=Studio"),
    "TeamRuns",
  );
  expect(runs.runs[0].phase).toBe("expired");
});
it.each(["start", "renew", "finish", "cancel", "abandon"])(
  "%s returns a schema-valid error for an unknown run",
  async (command) => {
    const input = { project, agent, runId: randomUUID() };
    if (command === "start") input.adapter = "synthetic";
    if (["finish", "cancel", "abandon"].includes(command))
      input.summary = "Synthetic result";
    if (command === "finish")
      Object.assign(input, {
        status: "review",
        artifacts: [],
        requestId: randomUUID(),
      });
    await schema(await post(command, input), "Error", 404);
  },
);
