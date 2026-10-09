import { randomUUID } from "node:crypto";
import { inspectRepository } from "./inspection.mjs";
import { previewMerge } from "./git.mjs";

export class Monitor {
  constructor(
    config,
    store,
    {
      inspect = inspectRepository,
      preview = previewMerge,
      ttl = 20_000,
      now = Date.now,
    } = {},
  ) {
    Object.assign(this, { config, store, inspect, preview, ttl, now });
    this.cache = new Map();
    this.scanTail = Promise.resolve();
    this.previewLocks = new Set();
  }
  repo(id) {
    const repo = this.config.repos.find((r) => r.id === id);
    if (!repo)
      throw Object.assign(new Error("Choose a configured repository."), {
        statusCode: 404,
      });
    return repo;
  }
  entry(id) {
    this.repo(id);
    if (!this.cache.has(id))
      this.cache.set(id, {
        status: null,
        error: null,
        lastAttempt: 0,
        pending: null,
      });
    return this.cache.get(id);
  }
  view(id) {
    const entry = this.entry(id);
    if (!entry.pending && this.now() - entry.lastAttempt >= this.ttl)
      this.refresh(id).catch(() => undefined);
    return {
      repoId: id,
      status: entry.status,
      error: entry.error,
      refreshing: Boolean(entry.pending),
      stale:
        !entry.status ||
        Boolean(entry.error) ||
        this.now() - Date.parse(entry.status.generatedAt) > 60_000,
    };
  }
  refresh(id) {
    const entry = this.entry(id);
    if (entry.pending) return entry.pending;
    entry.lastAttempt = this.now();
    const pending = this.scanTail.then(async () => {
      try {
        const status = await this.inspect(this.repo(id));
        entry.status = status;
        entry.error = null;
        return status;
      } catch (error) {
        entry.error = error.message;
        throw error;
      } finally {
        entry.lastAttempt = this.now();
        entry.pending = null;
      }
    });
    entry.pending = pending;
    this.scanTail = pending.catch(() => undefined); // Error is preserved on the affected repository.
    return pending;
  }
  async record(event) {
    await this.store.update((state) => ({
      ...state,
      history: [
        { id: randomUUID(), at: new Date().toISOString(), ...event },
        ...state.history,
      ].slice(0, 100),
    }));
  }
  async runPreview(id, branch, expected, source = "manual") {
    const repo = this.repo(id);
    if (this.previewLocks.has(id))
      throw Object.assign(
        new Error("A preview is already running for this repository."),
        { statusCode: 409 },
      );
    this.previewLocks.add(id);
    try {
      const status = await this.refresh(id);
      const wt = status.worktrees.find(
        (w) => w.branch === branch && !w.primary,
      );
      if (
        !wt ||
        wt.isDirty ||
        wt.inspectionError ||
        repo.excludedBranches.includes(branch) ||
        status.incomplete
      ) {
        throw Object.assign(
          new Error(
            "Choose a clean, inspectable task branch that is not parked.",
          ),
          { statusCode: 409 },
        );
      }
      const result = await this.preview(repo, branch, expected);
      await this.record({
        repoId: id,
        branch,
        source,
        outcome: result.outcome,
        message: result.message,
        headSha: result.headSha,
        baseSha: result.baseSha,
      });
      return result;
    } finally {
      this.previewLocks.delete(id);
    }
  }
}
