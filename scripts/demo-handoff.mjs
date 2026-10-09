import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createBoardStore } from "../server/board.mjs";

// A reproducible scripted example using the real store, with no installed state
// or live agents. The separate browser illustration never pretends to run this.
const directory = await mkdtemp(join(tmpdir(), "merge-monitor-demo-"));
try {
  const path = join(directory, "board.json");
  const board = await createBoardStore(path);
  const project = "demo";
  for (const agent of ["reviewer", "verifier"]) {
    await board.command("check-in", { project, agent, task: "Demonstrate a handoff", scope: "Disposable example state", state: "working" });
  }
  await board.command("post", { project, agent: "reviewer", to: "verifier", kind: "handoff", replyTo: "", requestId: randomUUID(), text: "Verify that acknowledgment keeps this request pending, including after reopening the store." });
  const request = board.view(project).room.messages[0];
  await board.command("ack", { project, agent: "verifier", messageId: request.id });
  assert.equal(board.view(project, "verifier").pendingIds.includes(request.id), true);
  const reopened = await createBoardStore(path);
  assert.equal(reopened.view(project, "verifier").pendingIds.includes(request.id), true);
  assert.ok(reopened.view(project).room.messages[0].acknowledgedAt);
  await reopened.command("post", { project, agent: "verifier", to: "reviewer", kind: "update", replyTo: request.id, requestId: randomUUID(), text: "PASS: acknowledgment preserved the pending request and reopening preserved both fields. Method: Node assert checks in scripts/demo-handoff.mjs against disposable state." });
  await reopened.command("resolve", { project, agent: "verifier", messageId: request.id });
  assert.equal(reopened.view(project, "verifier").pendingIds.includes(request.id), false);
  console.log(JSON.stringify({ kind: "scripted-demonstration", liveAgents: false, checks: ["acknowledgment preserves pending", "reopening preserves acknowledgment and pending", "resolution follows a linked evidence reply"], outcome: "passed", messages: reopened.view(project).room.messages }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
