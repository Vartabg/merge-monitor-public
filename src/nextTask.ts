import type { Worktree } from "./types";

export const taskKey = (task: Worktree) =>
  JSON.stringify([task.path, task.branch]);
