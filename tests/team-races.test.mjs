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

const project = "RaceFixture", agent = "worker", reviewer = "reviewer";
let folder, server, origin, token, assignments, raw, board, assignment, gate;
// Pause only after the real execution operation has durably published. Legacy
// assignment HTTP updates bypass the workflow's own serialization, as in the UI.
function barrier(store) {
  let command, entered, release, announce, wait;
  const proxy = new Proxy(store, { get(target, name) {
    if (typeof target[name] !== "function") return target[name];
    return (...args) => {
      if (name !== command) return target[name](...args);
      return target[name](...args).then(async result => {
        announce(result); await wait; return result;
      });
    };
  } });
  return { proxy, arm(name) {
    command = name;
    wait = new Promise(resolve => { release = resolve; });
    entered = new Promise(resolve => { announce = resolve; });
    return entered;
  }, release() { release?.(); command = undefined; } };
}
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mm-team-races-"));
  assignments = await createAssignmentStore(join(folder, "assignments.json"));
  board = await createBoardStore(join(folder, "board.json"));
  raw = await createExecutionStore(join(folder, "execution", "runs.json"));
  gate = barrier(raw);
  for (const name of [agent, reviewer]) await board.command("check-in", {
    project, agent: name, task: "Synthetic race", scope: "Fixture only", state: "working",
  });
  assignment = await assignments.create({ title: "Synthetic assignment race", project,
    purpose: "Preserve operator decisions", owner: agent, model: "synthetic", reviewer,
    scope: "Fixture only", acceptance: "No stale overwrite", budget: "No provider calls" });
  const monitor = { repo(id) {
    if (id !== project) throw Object.assign(Error("Unknown project"), { statusCode: 404 });
  } };
  server = createServer(createApi(monitor, {}, assignments, board, gate.proxy));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(origin + "/api/session")).json()).token;
});
afterEach(async () => {
  gate?.release();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
});
const post = (path, value) => fetch(origin + path, { method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json", "X-Merge-Monitor-Token": token },
  body: JSON.stringify(value) });
const team = (command, value) => post("/api/team/" + command, value);
async function claimed(start = false) {
  const response = await team("claim", { project, agent, assignmentId: assignment.id, requestId: randomUUID() });
  expect(response.status).toBe(200);
  const run = await response.json(), who = { project, agent, runId: run.runId };
  if (start) expect((await team("start", { ...who, adapter: "synthetic" })).status).toBe(200);
  return who;
}
async function operatorUpdate(status) {
  const current = assignments.list()[0];
  const response = await post("/api/assignments/update", { id: current.id, revision: current.revision,
    status, summary: `Operator chose ${status}`, artifacts: status === "accepted" ? ["/synthetic/evidence.md"] : [],
    reviewNote: status === "accepted" ? "Operator independently checked evidence" : "" });
  expect(response.status).toBe(200);
  return response.json();
}
async function reached(pause, pending) {
  return Promise.race([pause, pending.then(response => {
    throw Error(`Operation returned HTTP ${response.status} before reaching persistence barrier`);
  })]);
}
it("rejects start after an operator blocks during execution persistence; dispatch remains gated", async () => {
  const who = await claimed(), pause = gate.arm("start");
  let dispatches = 0;
  const pending = team("start", { ...who, adapter: "synthetic" }).then(response => {
    if (response.ok) dispatches++; return response;
  });
  expect((await reached(pause, pending)).phase).toBe("running");
  expect(raw.list(project)[0].phase).toBe("running");
  const blocked = await operatorUpdate("blocked"); gate.release();
  expect((await pending).status).toBe(409);
  expect(assignments.list()[0]).toEqual(blocked);
  expect(dispatches).toBe(0); // Model the launch gate; this test starts no process.
});
it("preserves an operator block made while a review result is being persisted", async () => {
  const who = await claimed(true), pause = gate.arm("finish");
  const pending = team("finish", { ...who, status: "review", summary: "Worker result",
    artifacts: ["/synthetic/result.md"], requestId: randomUUID() });
  expect((await reached(pause, pending)).phase).toBe("review");
  const blocked = await operatorUpdate("blocked"); gate.release();
  expect((await pending).status).toBe(409);
  expect(assignments.list()[0]).toEqual(blocked);
  expect(board.view(project).room.messages.filter(message => message.kind === "handoff")).toEqual([]);
});
it.each(["cancel", "abandon"])("%s cannot overwrite acceptance recorded during its awaited store operation", async command => {
  const who = await claimed(true), pause = gate.arm(command);
  const pending = team(command, { ...who, summary: "Worker cleanup report" });
  expect((await reached(pause, pending)).phase).toBe(command === "cancel" ? "cancelled" : "expired");
  await operatorUpdate("review"); const accepted = await operatorUpdate("accepted");
  gate.release(); const response = await pending;
  expect(response.status).toBe(409);
  expect(assignments.list()[0]).toEqual(accepted);
  const reopened = await createAssignmentStore(join(folder, "assignments.json"));
  expect(reopened.list()[0]).toEqual(accepted);
});
it.each(["queued", "working"])("claim preserves an operator %s edit made after the run reservation is persisted", async status => {
  const pause = gate.arm("claim");
  const pending = team("claim", { project, agent, assignmentId: assignment.id, requestId: randomUUID() });
  expect((await reached(pause, pending)).phase).toBe("claimed");
  const edited = await operatorUpdate(status); gate.release();
  expect((await pending).status).toBe(409);
  expect(assignments.list()[0]).toEqual(edited);
  expect(raw.list(project)[0].phase).toBe("cancelled");
});
it("renew rejects a permission grant when the operator blocks while its lease is saved", async () => {
  const who = await claimed(true), pause = gate.arm("renew"), pending = team("renew", who);
  expect((await reached(pause, pending)).phase).toBe("running");
  const blocked = await operatorUpdate("blocked"); gate.release();
  expect((await pending).status).toBe(409);
  expect(assignments.list()[0]).toEqual(blocked);
});
