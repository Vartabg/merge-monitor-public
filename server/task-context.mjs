const limits = {
  repoId: 120,
  path: 1024,
  branch: 300,
  title: 120,
  purpose: 800,
  owner: 120,
};
export const contextFields = Object.keys(limits);

export function validTaskContext(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    contextFields.every(
      (field) =>
        typeof value[field] === "string" &&
        value[field].length <= limits[field],
    ) &&
    [value.repoId, value.path, value.branch].every(
      (field) => field.trim().length > 0,
    )
  );
}

export async function saveTaskContext(monitor, value) {
  if (!validTaskContext(value)) {
    throw Object.assign(
      new Error(
        "Use a task name and owner up to 120 characters and a purpose up to 800 characters.",
      ),
      { statusCode: 400 },
    );
  }
  const status = await monitor.refresh(value.repoId);
  if (
    !status.worktrees.some(
      (w) => !w.primary && w.path === value.path && w.branch === value.branch,
    )
  ) {
    throw Object.assign(
      new Error(
        "This task is no longer in the project. Refresh the board before saving its context.",
      ),
      { statusCode: 409 },
    );
  }
  const context = {
    repoId: value.repoId,
    path: value.path,
    branch: value.branch,
    title: value.title.trim(),
    purpose: value.purpose.trim(),
    owner: value.owner.trim(),
    updatedAt: new Date().toISOString(),
  };
  try {
    await monitor.store.update((state) => ({
      ...state,
      taskContexts: [
        context,
        ...(state.taskContexts || []).filter(
          (item) =>
            item.repoId !== context.repoId ||
            item.path !== context.path ||
            item.branch !== context.branch,
        ),
      ],
    }));
  } catch {
    throw new Error(
      "Task context could not be saved on this Mac. Check the service's state folder and try again.",
    );
  }
  return context;
}
