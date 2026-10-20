export function validateParticipants(input, monitor, board) {
  if (!monitor?.repo || !board?.view)
    throw Object.assign(
      new Error(
        "The project board is unavailable. Restart Merge Monitor and try again.",
      ),
      { statusCode: 503 },
    );
  try {
    monitor.repo(input.project);
  } catch {
    throw Object.assign(
      new Error("Choose a configured project before saving this assignment."),
      { statusCode: 400 },
    );
  }
  const members = board.view(input.project).room.members;
  for (const field of ["owner", "reviewer"])
    if (!members.some((member) => member.agent === input[field]))
      throw Object.assign(
        new Error(
          `Check the ${field === "owner" ? "assigned agent" : "reviewer"} into this project board before saving the assignment.`,
        ),
        { statusCode: 400 },
      );
}
