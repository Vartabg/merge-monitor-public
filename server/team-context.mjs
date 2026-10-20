export const fail = (message, statusCode = 409) => {
  throw Object.assign(new Error(message), { statusCode });
};
export function teamContext({ monitor, assignments, board, executions }) {
  const find = (id) =>
    assignments.list().find((item) => item.id === id) ||
    fail("Choose an existing assignment and retry.", 404);
  function participant(project, agent) {
    monitor.repo(project);
    if (!board.view(project).room.members.some((item) => item.agent === agent))
      fail(
        "Check this agent into the project board before claiming work.",
        403,
      );
  }
  function assignmentFor(input) {
    const runs = executions.list(input.project);
    const run = runs.find((item) => item.runId === input.runId);
    if (!run) fail("Choose an existing run from this project.", 404);
    if (
      runs.filter((item) => item.assignmentId === run.assignmentId).at(-1)
        ?.runId !== run.runId
    )
      fail(
        "A newer attempt owns this assignment. Do not publish an older result.",
      );
    return find(run.assignmentId);
  }
  function inbox({ project, agent }) {
    monitor.repo(project);
    const all = assignments.list().filter((item) => item.project === project);
    const owned = all.filter(
      (item) => item.owner === agent && item.status === "queued",
    );
    const reviews = all.filter(
      (item) => item.reviewer === agent && item.status === "review",
    );
    const requests = board
      .view(project)
      .room.messages.filter((item) => item.to === agent && !item.resolvedAt);
    const runs = executions
      .list(project)
      .filter(
        (item) =>
          item.agent === agent ||
          all.some((a) => a.id === item.assignmentId && a.reviewer === agent),
      );
    return {
      version: 1,
      project,
      agent,
      assignments: owned.slice(0, 20),
      reviews: reviews.slice(0, 20),
      requests: requests.slice(0, 8),
      runs: runs.slice(-20),
      counts: {
        assignments: owned.length,
        reviews: reviews.length,
        requests: requests.length,
        runs: runs.length,
      },
    };
  }
  function unchanged(snapshot) {
    if (find(snapshot.id).revision !== snapshot.revision)
      fail(
        "The assignment changed during this request. Preserve the result and inspect its latest status.",
      );
  }
  return { find, participant, assignmentFor, inbox, unchanged };
}
