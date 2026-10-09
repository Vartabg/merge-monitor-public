export function createWorker(monitor, { interval = 30_000 } = {}) {
  let timer,
    active = false,
    closed = false,
    lastRun = null,
    error = null;
  let heartbeat = new Date().toISOString();
  const view = () => ({
    enabled: monitor.store.get().enabled,
    status: active
      ? "running"
      : error
        ? "error"
        : monitor.store.get().enabled
          ? "idle"
          : "paused",
    heartbeat,
    lastRun,
    error,
  });
  async function run() {
    heartbeat = new Date().toISOString();
    if (active || closed || !monitor.store.get().enabled) return view();
    active = true;
    error = null;
    const failures = [];
    try {
      for (const repo of monitor.config.repos) {
        if (closed || !monitor.store.get().enabled) break;
        try {
          const status = await monitor.refresh(repo.id);
          for (const wt of status.worktrees
            .filter((w) => w.category === "ready")
            .slice(0, 3)) {
            if (closed || !monitor.store.get().enabled) break;
            const expected = { headSha: wt.headSha, baseSha: status.baseSha };
            const alreadyChecked = monitor.store
              .get()
              .history.some(
                (e) =>
                  e.repoId === repo.id &&
                  e.branch === wt.branch &&
                  e.headSha === expected.headSha &&
                  e.baseSha === expected.baseSha &&
                  e.outcome === "clean",
              );
            if (!alreadyChecked)
              await monitor.runPreview(repo.id, wt.branch, expected, "worker");
          }
        } catch (failure) {
          failures.push(`${repo.label}: ${failure.message}`);
          await monitor.record({
            repoId: repo.id,
            branch: "",
            source: "worker",
            outcome: "error",
            message: failure.message,
            headSha: "",
            baseSha: "",
          });
        }
      }
      error = failures.length ? failures.join(" ") : null;
    } catch (failure) {
      error = failure.message;
    } finally {
      active = false;
      lastRun = new Date().toISOString();
      heartbeat = lastRun;
    }
    return view();
  }
  async function schedule() {
    await run();
    if (!closed) {
      timer = setTimeout(schedule, interval);
      timer.unref();
    }
  }
  return {
    view,
    run,
    start: () => {
      closed = false;
      void schedule();
    },
    stop: () => {
      closed = true;
      clearTimeout(timer);
    },
    setEnabled: async (enabled) => {
      await monitor.store.update((state) => ({ ...state, enabled }));
      error = null;
      await monitor.record({
        repoId: "",
        branch: "",
        source: "manual",
        outcome: "setting",
        message: `Preview worker ${enabled ? "enabled" : "paused"}.`,
        headSha: "",
        baseSha: "",
      });
      if (enabled) void run();
      return view();
    },
  };
}
