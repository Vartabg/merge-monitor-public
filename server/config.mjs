import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

export async function loadConfig(root) {
  const config = JSON.parse(
    await readFile(resolve(root, "monitor.config.json"), "utf8"),
  );
  if (!Array.isArray(config.repos) || !config.repos.length)
    throw new Error(
      "Configure at least one repository in monitor.config.json.",
    );
  const ids = new Set();
  const repos = await Promise.all(
    config.repos.map(async (repo) => {
      if (
        !repo ||
        typeof repo.id !== "string" ||
        !/^[a-z0-9][a-z0-9-]*$/.test(repo.id) ||
        ids.has(repo.id)
      )
        throw new Error("Repository IDs must be unique lowercase names.");
      ids.add(repo.id);
      if (typeof repo.path !== "string" || typeof repo.label !== "string")
        throw new Error("Each repository needs a path and label.");
      if (
        repo.defaultBranch !== undefined &&
        typeof repo.defaultBranch !== "string"
      )
        throw new Error("defaultBranch must be a branch name.");
      if (
        repo.excludedBranches !== undefined &&
        (!Array.isArray(repo.excludedBranches) ||
          repo.excludedBranches.some((b) => typeof b !== "string"))
      )
        throw new Error("excludedBranches must be a list of branch names.");
      const path = resolve(homedir(), repo.path.replace(/^~\//, ""));
      // Missing repositories stay visible with a per-repository error; they do not stop the service.
      const canonical = await realpath(path).catch((error) => {
        if (error.code === "ENOENT") return path;
        throw error;
      });
      return {
        id: repo.id,
        label: repo.label,
        path: canonical,
        ...(repo.defaultBranch ? { defaultBranch: repo.defaultBranch } : {}),
        excludedBranches: repo.excludedBranches || [],
      };
    }),
  );
  return {
    repos,
    defaultRepo:
      repos.find((r) => r.id === config.defaultRepo)?.id || repos[0].id,
  };
}
