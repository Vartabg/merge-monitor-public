import { teamContext, fail } from "./team-context.mjs";
import { createHash } from "node:crypto";
const terminalMessageId = (result) => {
  const hex = createHash("sha256")
    .update(`${result.runId}:${result.phase}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export function createTeamWorkflow(dependencies) {
  const { monitor, assignments, board, executions } = dependencies;
  const { find, participant, assignmentFor, inbox, unchanged } =
    teamContext(dependencies);
  const update = async (current, status, summary,
    artifacts = current.artifacts, reviewNote = current.reviewNote) =>
    assignments.update({
      id: current.id,
      revision: current.revision,
      status,
      summary,
      artifacts,
      reviewNote,
    });
  async function handoff(result, assignment, cancelled = false) {
    try {
      await board.command("post", {
        project: result.project,
        agent: result.agent,
        to: assignment.reviewer,
        replyTo: "",
        requestId: cancelled
          ? terminalMessageId(result)
          : result.finishRequestId,
        kind: cancelled ? "blocker" : "handoff",
        attention: cancelled || result.phase === "blocked" ? "action" : "fyi",
        text: `Run ${result.runId} for assignment ${assignment.id}: ${result.phase}.\n${result.summary}\nAdapter: ${result.adapter || "not started"}. Review evidence before accepting; this is a worker report.`,
      });
    } catch {
      fail(
        "The result was saved but its handoff failed. Retry this exact request to deliver it.",
        503,
      );
    }
  }
  const workflow = {
    inbox,
    runs({ project }) {
      monitor.repo(project);
      return { version: 1, project, runs: executions.list(project) };
    },
    async claim(input) {
      participant(input.project, input.agent);
      const assignment = find(input.assignmentId);
      participant(input.project, assignment.reviewer);
      const run = await executions.claim(input, assignment);
      if (run.phase !== "claimed") return run;
      if (assignment.revision !== run.assignmentRevision) {
        unchanged(assignment);
        if (assignment.status !== "working")
          fail("This claim predates an assignment edit. Read its latest status and confirm cleanup before requesting a new run.");
        return run;
      }
      try {
        if (assignment.status === "queued")
          await update(
            assignment,
            "working",
            `Claimed run ${run.runId}; worker has not reported starting yet.`,
          );
        else {
          unchanged(assignment);
          if (assignment.status !== "working")
            fail(
              "This assignment changed before dispatch. Read its latest status.",
            );
        }
      } catch (error) {
        await executions.cancel({
          project: input.project,
          agent: input.agent,
          runId: run.runId,
          summary:
            "Dispatch stopped because the assignment changed before start.",
        });
        throw error;
      }
      return run;
    },
    async start(input) {
      participant(input.project, input.agent);
      const assignment = assignmentFor(input);
      if (assignment.status !== "working")
        fail(
          "The assignment is no longer working. Stop this worker and inspect its status.",
        );
      const result = await executions.start(input, assignment.revision);
      unchanged(assignment);
      if (assignment.revision === result.startAssignmentRevision)
        await update(
          assignment,
          "working",
          `Worker ${result.agent} reported starting run ${result.runId} with ${result.adapter}. Check its lease and result before relying on completion.`,
        );
      return result;
    },
    async renew(input) {
      participant(input.project, input.agent);
      const assignment = assignmentFor(input);
      if (assignment.status !== "working")
        fail("The assignment changed. Stop the worker before retrying.");
      const result = await executions.renew(input);
      unchanged(assignment);
      return result;
    },
    async finish(input) {
      participant(input.project, input.agent);
      const assignment = assignmentFor(input);
      const previous = executions.list(input.project).find((run) => run.runId === input.runId);
      if (
        !previous.finishRequestId &&
        (assignment.status === "accepted" || (input.status === "review" &&
        !["working", "review"].includes(assignment.status)))
      )
        fail(
          "The assignment changed. Keep the result and request coordinator review.",
        );
      const result = await executions.finish(input, assignment.revision);
      unchanged(assignment);
      // This revision is saved before the queue write. Only a missing publication
      // may be retried; later reviewer edits (including the same status) survive.
      // Legacy terminal records have no fence, so never rewrite their queue.
      if (assignment.revision === result.finishAssignmentRevision)
        await update(
          assignment,
          input.status,
          result.summary,
          result.artifacts,
          "",
        );
      await handoff(result, assignment);
      return result;
    },
    ...Object.fromEntries(
      ["cancel", "abandon"].map((command) => [
        command,
        async (input) => {
          participant(input.project, input.agent);
          const assignment = assignmentFor(input),
            result = await executions[command](input, assignment.revision);
          unchanged(assignment);
          if (assignment.status === "working" &&
              assignment.revision === result.cleanupAssignmentRevision)
            await update(assignment, "blocked", result.summary);
          await handoff(result, assignment, true);
          return result;
        },
      ]),
    ),
  };
  let tail = Promise.resolve();
  for (const command of [
    "claim",
    "start",
    "renew",
    "finish",
    "cancel",
    "abandon",
  ]) {
    const operation = workflow[command];
    workflow[command] = (input) => {
      const pending = tail.then(() => operation(input));
      tail = pending.catch(() => undefined);
      return pending;
    };
  }
  return workflow;
}
