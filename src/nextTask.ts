import type { Worktree } from "./types";

export const taskKey = (task: Worktree) =>
  JSON.stringify([task.path, task.branch]);

export function nextTask(tasks: Worktree[], excluded: string[]) {
  const eligible = tasks.filter(
    (task) => !task.primary && !excluded.includes(task.branch),
  );
  return (
    eligible.find((task) => task.category === "attention") ||
    eligible.find((task) => task.category === "ready")
  );
}
