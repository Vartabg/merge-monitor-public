import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAssignmentStore } from "../server/assignments.mjs";
import { createExecutionStore } from "../server/executions.mjs";
import { createBoardStore } from "../server/board.mjs";
import { createTeamWorkflow } from "../server/team-workflow.mjs";

export const project = "PublicationFixture", agent = "worker", reviewer = "reviewer";
export async function publicationFixture({ start = true, claim = true } = {}) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "mm-publication-")));
  const paths = { assignments: join(folder, "assignments.json"),
    executions: join(folder, "runtime", "runs.json"), board: join(folder, "board.json") };
  const fixture = { folder, paths, cleanup: () => rm(folder, { recursive: true, force: true }) };
  fixture.reopen = async () => {
    fixture.assignments = await createAssignmentStore(paths.assignments);
    fixture.executions = await createExecutionStore(paths.executions);
    fixture.board = await createBoardStore(paths.board);
    fixture.workflow = createTeamWorkflow({ monitor: { repo: () => {} },
      assignments: fixture.assignments, executions: fixture.executions, board: fixture.board });
  };
  fixture.update = async (status, overrides = {}) => {
    const item = fixture.assignments.list()[0];
    return fixture.assignments.update({ id: item.id, revision: item.revision,
      status, summary: "Reviewer requests corrections.", artifacts: ["/synthetic/review.md"],
      reviewNote: "Check the missing boundary case.", ...overrides });
  };
  await fixture.reopen();
  for (const name of [agent, reviewer]) await fixture.board.command("check-in", {
    project, agent: name, task: "Publication recovery", scope: "Synthetic only", state: "working",
  });
  const assignment = await fixture.assignments.create({ title: "Retry publication", project,
    purpose: "Keep reviewer decisions", owner: agent, reviewer, model: "synthetic",
    scope: "Fixture", acceptance: "Safe retries after restart", budget: "No provider calls" });
  fixture.claim = () => fixture.workflow.claim({ project, agent,
    assignmentId: assignment.id, requestId: randomUUID() });
  fixture.assignment = assignment;
  if (!claim) return fixture;
  const run = await fixture.claim();
  fixture.who = { project, agent, runId: run.runId };
  fixture.start = () => fixture.workflow.start({ ...fixture.who, adapter: "synthetic" });
  if (start) await fixture.start();
  fixture.input = { ...fixture.who, status: "review", summary: "Final verified result.",
    artifacts: ["/synthetic/final.md"], requestId: randomUUID() };
  fixture.handoffs = () => fixture.board.view(project).room.messages.filter(m => m.kind === "handoff");
  return fixture;
}
