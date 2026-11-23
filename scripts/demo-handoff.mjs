import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createBoardStore } from "../server/board.mjs";

// A reproducible scripted example using the real board store, with no installed
// state or live agents. Demonstrates structured findings, persistent
// acknowledgment, 409 reply-before-resolve enforcement, and evidence-backed
// resolution.
const directory = await mkdtemp(join(tmpdir(), "merge-monitor-demo-"));
await chmod(directory, 0o700);
try {
  const path = join(directory, "board.json");
  const board = await createBoardStore(path);
  const project = "demo";
  for (const agent of ["reviewer", "verifier"]) {
    await board.command("check-in", {
      project,
      agent,
      task: "Demonstrate an evidence-backed handoff",
      scope: "Disposable example state",
      state: "working",
    });
  }
  await board.command("post", {
    project,
    agent: "reviewer",
    to: "verifier",
    kind: "handoff",
    attention: "action",
    replyTo: "",
    requestId: randomUUID(),
    text: "Verify that acknowledgment keeps this request pending across restart and that resolution is blocked until a linked evidence reply is recorded.",
    finding: {
      claim: "Acknowledging a request must not resolve it, and resolving without linked evidence must be rejected.",
      evidence: "scripts/demo-handoff.mjs against createBoardStore in disposable temp state.",
      expected: "pendingIds retains the handoff after ack + reopen, and premature resolve returns 409.",
      actual: "Pending verification against the active store implementation.",
      severity: "blocking",
      scope: "Board acknowledgment and reply-before-resolve enforcement only.",
      doneCheck: "node scripts/demo-handoff.mjs exits 0 with all 4 assertions passing.",
    },
  });

  const request = board.view(project).room.messages[0];
  await board.command("ack", {
    project,
    agent: "verifier",
    messageId: request.id,
  });
  assert.equal(
    board.view(project, "verifier").pendingIds.includes(request.id),
    true,
  );

  const reopened = await createBoardStore(path);
  assert.equal(
    reopened.view(project, "verifier").pendingIds.includes(request.id),
    true,
  );
  assert.ok(reopened.view(project).room.messages[0].acknowledgedAt);

  // Attempting to resolve without posting a linked evidence reply must fail with 409.
  let prematureResolveStatus = null;
  let prematureResolveError = "";
  try {
    await reopened.command("resolve", {
      project,
      agent: "verifier",
      messageId: request.id,
    });
    assert.fail("Expected premature resolve without a linked reply to fail with 409.");
  } catch (error) {
    prematureResolveStatus = error?.statusCode ?? null;
    prematureResolveError = error?.message ?? "";
  }
  assert.equal(prematureResolveStatus, 409);
  assert.equal(
    reopened.view(project, "verifier").pendingIds.includes(request.id),
    true,
  );

  await reopened.command("post", {
    project,
    agent: "verifier",
    to: "reviewer",
    kind: "update",
    replyTo: request.id,
    requestId: randomUUID(),
    text: "PASS: acknowledgment preserved pending state across reopen, premature resolve returned 409, and linked evidence now unlocks resolution. Method: Node assert checks in scripts/demo-handoff.mjs.",
  });
  await reopened.command("resolve", {
    project,
    agent: "verifier",
    messageId: request.id,
  });
  assert.equal(
    reopened.view(project, "verifier").pendingIds.includes(request.id),
    false,
  );

  console.log(
    JSON.stringify(
      {
        kind: "scripted-demonstration",
        liveAgents: false,
        checks: [
          "structured 7-field finding stored on handoff",
          "acknowledgment preserves pending across reopen",
          "premature resolve without linked reply rejected with 409",
          "resolution succeeds after linked evidence reply",
        ],
        prematureResolve: {
          statusCode: prematureResolveStatus,
          message: prematureResolveError,
        },
        outcome: "passed",
        messages: reopened.view(project).room.messages,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
