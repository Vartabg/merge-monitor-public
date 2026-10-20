import { randomUUID } from "node:crypto";
import { executionFile } from "./execution-file.mjs";
import { MAX_RUNS, RESERVING, assignmentBinding, fail, text,
  validateInput } from "./execution-validation.mjs";

// Durable client-reported execution ledger, not proof a provider ran. One server
// owns this file; every phase/claim check is inside its serialized transaction.
export async function createExecutionStore(path, {
  clock = () => Date.now(), leaseMs = 120000, maxActive = 3,
} = {}) {
  if (typeof clock !== "function" || !Number.isSafeInteger(leaseMs) || leaseMs < 1 ||
      leaseMs > 3600000 || !Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > MAX_RUNS)
    fail("Invalid execution store options.");
  const file = await executionFile(path);
  let state = structuredClone(file.state), tail = Promise.resolve();
  function now() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || value + leaseMs > 8640000000000000)
      fail("Execution clock must return valid epoch milliseconds.");
    return value;
  }
  function observed(runs, time) {
    return runs.map(run => ["claimed", "running"].includes(run.phase) &&
      Date.parse(run.leaseUntil) <= time ? { ...run, phase: "expired" } : run);
  }
  function transaction(task) {
    const pending = tail.then(async () => {
      const time = now(), next = { version: 1, runs: observed(structuredClone(state.runs), time) };
      const result = task(next, time);
      await file.save(next); state = next;
      return structuredClone(result);
    });
    tail = pending.catch(() => undefined);
    return pending;
  }
  function owned(next, input) {
    const run = next.runs.find(item => item.runId === input.runId);
    if (!run) fail("Unknown execution run.", 404);
    if (run.project !== input.project || run.agent !== input.agent)
      fail("Execution project or agent does not match its claim.", 409);
    return run;
  }
  function live(run, phases) {
    if (!phases.includes(run.phase)) fail(`Cannot act on ${run.phase} execution.`, 409);
  }
  function update(run, fields, time) {
    Object.assign(run, fields, { updatedAt: new Date(time).toISOString() });
    return run;
  }
  function publication(run, field, revision) {
    if (revision === undefined) return {};
    if (!Number.isSafeInteger(revision) || revision < run.assignmentRevision)
      fail("Publication needs the current assignment revision. Read the assignment and retry.");
    return { [field]: revision };
  }
  return {
    capacity() { return { used: state.runs.length, limit: MAX_RUNS }; },
    list(project) {
      const clean = text(project, "project");
      return structuredClone(observed(state.runs, now()).filter(run => run.project === clean));
    },
    async claim(input, assignment) {
      const clean = validateInput("claim", input), item = assignmentBinding(assignment);
      return transaction((next, time) => {
        if (clean.assignmentId !== item.id || clean.project !== item.project || clean.agent !== item.owner)
          fail("Claim must match the authoritative assignment id, project and owner.", 409);
        const retry = next.runs.find(run => run.requestId === clean.requestId || run.finishRequestId === clean.requestId);
        if (retry) {
          if (retry.requestId !== clean.requestId || retry.assignmentId !== clean.assignmentId ||
              retry.project !== clean.project || retry.agent !== clean.agent)
            fail("Claim requestId is already bound to different work.", 409);
          return retry;
        }
        if (item.status !== "queued") fail("Only queued assignments can be claimed.", 409);
        if (next.runs.some(run => run.assignmentId === item.id && RESERVING.has(run.phase)))
          fail("Assignment already has a reserved execution.", 409);
        if (next.runs.filter(run => RESERVING.has(run.phase)).length >= maxActive)
          fail("Execution capacity is reserved; explicitly cancel stale work before replacement.", 409);
        if (next.runs.length >= MAX_RUNS) fail("Maximum 500 execution runs reached.", 409);
        const stamp = new Date(time).toISOString();
        const run = { runId: randomUUID(), assignmentId: item.id, assignmentRevision: item.revision,
          project: clean.project, agent: clean.agent, phase: "claimed", requestId: clean.requestId,
          finishRequestId: "", adapter: "", createdAt: stamp, updatedAt: stamp,
          leaseUntil: new Date(time + leaseMs).toISOString(), summary: "", artifacts: [] };
        next.runs.push(run); return run;
      });
    },
    async start(input, assignmentRevision) {
      const clean = validateInput("start", input);
      return transaction((next, time) => {
        const run = owned(next, clean); live(run, ["claimed", "running"]);
        if (run.phase === "running") {
          if (run.adapter !== clean.adapter) fail("Execution already started with another adapter.", 409);
          return run;
        }
        return update(run, { phase: "running", adapter: clean.adapter,
          ...publication(run, "startAssignmentRevision", assignmentRevision),
          leaseUntil: new Date(time + leaseMs).toISOString() }, time);
      });
    },
    async renew(input) {
      const clean = validateInput("renew", input);
      return transaction((next, time) => {
        const run = owned(next, clean); live(run, ["running"]);
        return update(run, { leaseUntil: new Date(time + leaseMs).toISOString() }, time);
      });
    },
    async finish(input, assignmentRevision) {
      const clean = validateInput("finish", input);
      return transaction((next, time) => {
        const run = owned(next, clean);
        if (run.finishRequestId !== "") {
          if (run.finishRequestId === clean.requestId && run.phase === clean.status &&
              run.summary === clean.summary && JSON.stringify(run.artifacts) === JSON.stringify(clean.artifacts)) return run;
          fail("Finish retry differs from the recorded result.", 409);
        }
        live(run, ["running"]);
        if (next.runs.some(item => item.requestId === clean.requestId || item.finishRequestId === clean.requestId))
          fail("Finish requestId is already bound to another operation.", 409);
        return update(run, { phase: clean.status, summary: clean.summary,
          artifacts: clean.artifacts, finishRequestId: clean.requestId,
          ...publication(run, "finishAssignmentRevision", assignmentRevision) }, time);
      });
    },
    async cancel(input, assignmentRevision) {
      const clean = validateInput("cancel", input);
      return transaction((next, time) => {
        const run = owned(next, clean);
        if (run.phase === "cancelled" && run.summary === clean.summary) return run;
        live(run, ["claimed", "running", "expired"]);
        return update(run, { phase: "cancelled", summary: clean.summary,
          ...publication(run, "cleanupAssignmentRevision", assignmentRevision) }, time);
      });
    },
    async abandon(input, assignmentRevision) {
      const clean = validateInput("abandon", input);
      return transaction((next, time) => {
        const run = owned(next, clean);
        live(run, ["claimed", "running", "expired"]);
        if (run.phase === "expired" && run.summary !== "") {
          if (run.summary === clean.summary) return run;
          fail("Abandon retry differs from the recorded uncertainty.", 409);
        }
        // A stopped direct child does not prove its descendants stopped. Keep
        // the reservation fenced until an explicit externally confirmed cancel.
        return update(run, { phase: "expired", summary: clean.summary,
          ...publication(run, "cleanupAssignmentRevision", assignmentRevision),
          leaseUntil: new Date(time).toISOString() }, time);
      });
    },
  };
}
