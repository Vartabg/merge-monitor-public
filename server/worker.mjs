import { reapMergedWorktrees } from "./git-inventory.mjs";
import { RESERVING } from "./execution-validation.mjs";

export function createWorker(
  monitor,
  { interval = 30_000, reap = reapMergedWorktrees, executions = null } = {},
) {
  let timer,
    generation = 0,
    active = false,
    closed = false,
    lastRun = null,
    error = null;
  let heartbeat = new Date().toISOString();
  const heldGates = new Set();
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
          let status = await monitor.refresh(repo.id);
          const allMergedClean =
            !status.degraded && !status.incomplete
              ? status.worktrees.filter(
                  (w) => !w.primary && w.merged && !w.isDirty,
                )
              : [];
          const excludedMergedClean = allMergedClean.filter((w) =>
            repo.excludedBranches.includes(w.branch),
          );
          const mergedClean = allMergedClean.filter(
            (w) => !repo.excludedBranches.includes(w.branch),
          );
          const activeGateKeys = new Set([
            ...excludedMergedClean.map(
              (w) => `${repo.id}:excluded:${w.branch}@${w.headSha}`,
            ),
            ...mergedClean.map(
              (w) => `${repo.id}:gate:${w.path}@${w.headSha}`,
            ),
          ]);
          for (const key of heldGates) {
            if (key.startsWith(`${repo.id}:`) && !activeGateKeys.has(key)) {
              heldGates.delete(key);
            }
          }
          let notes = [
            status.degraded,
            ...(status.housekeeping || []).map((item) => item.message),
          ].filter(Boolean);
          const hasActiveExecution = Boolean(
            executions &&
              executions
                .list(repo.id)
                .some((runEntry) => RESERVING.has(runEntry.phase)),
          );
          if (
            mergedClean.length > 0 &&
            excludedMergedClean.length > 0 &&
            !hasActiveExecution &&
            reap
          ) {
            const unseenExcluded = excludedMergedClean.filter(
              (w) =>
                !heldGates.has(
                  `${repo.id}:excluded:${w.branch}@${w.headSha}`,
                ),
            );
            for (const w of excludedMergedClean) {
              heldGates.add(`${repo.id}:excluded:${w.branch}@${w.headSha}`);
            }
            if (unseenExcluded.length > 0) {
              notes.push(
                `Auto-reap paused while excluded merged branch(es) remain parked (${unseenExcluded
                  .map((w) => w.branch)
                  .slice(0, 5)
                  .join(", ")}).`,
              );
            }
          } else if (
            mergedClean.length > 0 &&
            !hasActiveExecution &&
            reap &&
            mergedClean.some(
              (w) => !heldGates.has(`${repo.id}:gate:${w.path}@${w.headSha}`),
            )
          ) {
            let reaped;
            let reapFailed = false;
            try {
              reaped = await reap(repo);
            } catch (reapError) {
              reapFailed = true;
              for (const w of mergedClean) {
                heldGates.add(`${repo.id}:gate:${w.path}@${w.headSha}`);
              }
              failures.push(`${repo.label}: ${reapError.message}`);
              await monitor.record({
                repoId: repo.id,
                branch: "",
                source: "worker",
                outcome: "error",
                message: reapError.message,
                headSha: "",
                baseSha: status.baseSha,
              });
            }
            if (!reapFailed && Array.isArray(reaped)) {
              const reapedPaths = new Set(reaped.map((item) => item.path));
              if (reaped.length > 0) {
                await monitor.record({
                  repoId: repo.id,
                  branch: reaped.length === 1 ? reaped[0].branch : "",
                  source: "worker",
                  outcome: "clean",
                  message: `Ground control cleared ${reaped.length} merged worktree${reaped.length === 1 ? "" : "s"} (${reaped
                    .map((r) => r.branch)
                    .slice(0, 5)
                    .join(", ")}).`,
                  headSha: "",
                  baseSha: status.baseSha,
                });
                status = await monitor.refresh(repo.id);
                notes = [
                  status.degraded,
                  ...(status.housekeeping || []).map((item) => item.message),
                ].filter(Boolean);
              }
              const stillParked = mergedClean.filter(
                (w) => !reapedPaths.has(w.path),
              );
              const newlyHeld = stillParked.filter(
                (w) =>
                  !heldGates.has(`${repo.id}:gate:${w.path}@${w.headSha}`),
              );
              for (const w of stillParked) {
                heldGates.add(`${repo.id}:gate:${w.path}@${w.headSha}`);
              }
              if (newlyHeld.length > 0) {
                notes.push(
                  `${newlyHeld.length} merged working ${newlyHeld.length === 1 ? "copy stayed" : "copies stayed"} parked (${newlyHeld
                    .map((w) => w.branch)
                    .slice(0, 5)
                    .join(", ")}): local ignored files or un-reaped branch state.`,
                );
              }
            }
          }
          if (notes.length)
            await monitor.record({
              repoId: repo.id,
              branch: "",
              source: "worker",
              outcome: "error",
              message: `${status.degraded ? "Partial check" : "Housekeeping"}: ${notes.join(" ")}`,
              headSha: "",
              baseSha: status.baseSha,
            });
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
  async function schedule(myGen) {
    if (closed || myGen !== generation) return;
    await run();
    if (!closed && myGen === generation) {
      timer = setTimeout(() => void schedule(myGen), interval);
      timer.unref();
    }
  }
  return {
    view,
    run,
    start: () => {
      clearTimeout(timer);
      closed = false;
      const myGen = ++generation;
      void schedule(myGen);
    },
    stop: () => {
      closed = true;
      generation++;
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
