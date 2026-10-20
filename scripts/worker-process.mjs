import { spawn } from 'node:child_process';

// Signals target only the group created by this invocation, never escaped groups.
export async function runOwnedChild(spec, { prompt = '', deadline, renew, signal,
  heartbeatMs = 5000, leaseUntil = Infinity } = {}) {
  const startedAt = new Date().toISOString(), heartbeatAbort = new AbortController();
  let child, reason = 'exited', exitCode = null, exitSignal = null, finished = false;
  let stdoutBytes = 0, stderrBytes = 0, renewing = false, directChildReaped = false;
  let killTimer, drainTimer, deadlineTimer, leaseTimer, heartbeatTimer;
  const lease = typeof leaseUntil === 'string' ? Date.parse(leaseUntil) : leaseUntil;
  const abort = () => stop('cancelled');
  let complete;
  function groupSignal(name) {
    if (!child?.pid || finished) return;
    try { process.kill(-child.pid, name); } catch { /* Owned group may have exited. */ }
  }
  function stopHeartbeat() {
    clearInterval(heartbeatTimer); clearTimeout(leaseTimer); heartbeatAbort.abort();
  }
  function settle() {
    if (finished) return;
    finished = true; stopHeartbeat();
    for (const timer of [killTimer, drainTimer, deadlineTimer]) clearTimeout(timer);
    signal?.removeEventListener('abort', abort); complete();
  }
  function uncertain() {
    if (finished) return;
    // An escaped descendant can hold inherited pipes after its parent exits.
    // Close our pipe handles rather than wait indefinitely or signal that group.
    groupSignal('SIGKILL'); reason = 'descendant-uncertain';
    for (const pipe of [child?.stdin, child?.stdout, child?.stderr]) pipe?.destroy();
    if (!directChildReaped) child?.unref();
    settle();
  }
  function stop(next) {
    if (finished || reason !== 'exited') return;
    reason = next; groupSignal('SIGTERM');
    killTimer = setTimeout(() => { groupSignal('SIGKILL'); drainTimer = setTimeout(uncertain, 50); }, 250);
  }
  function armLease(value) {
    clearTimeout(leaseTimer);
    const until = typeof value === 'string' ? Date.parse(value) : value;
    if (until === Infinity) return;
    if (!Number.isFinite(until) || until <= Date.now()) { stop('lease-lost'); return; }
    leaseTimer = setTimeout(() => stop('lease-lost'), Math.min(2147483647, until - Date.now()));
  }
  if (signal?.aborted || !Number.isFinite(deadline) || deadline <= Date.now())
    return { pid: null, exitCode, signal: null, directChildReaped, reason: signal?.aborted ? 'cancelled' : 'timeout',
      stdoutBytes, stderrBytes, startedAt, endedAt: new Date().toISOString() };
  await new Promise(resolve => {
    complete = resolve;
    try {
      child = spawn(spec.file, spec.args, { cwd: spec.cwd, shell: false, detached: true,
        stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { reason = 'spawn-failed'; settle(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => { if (reason === 'exited') reason = 'spawn-failed'; });
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 128 * 1024) stop('output-limit');
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 16 * 1024) stop('output-limit');
    });
    child.on('exit', (code, value) => {
      directChildReaped = true; exitCode = code; exitSignal = value;
      if (finished) return;
      stopHeartbeat(); groupSignal('SIGTERM');
      // Direct exit is not pipe closure: descendants may still own descriptors.
      clearTimeout(drainTimer); drainTimer = setTimeout(uncertain, 50);
    });
    child.on('close', (code, value) => {
      if (finished) return;
      exitCode = code; exitSignal = value; groupSignal('SIGKILL'); settle();
    });
    deadlineTimer = setTimeout(() => stop('timeout'), deadline - Date.now());
    armLease(lease);
    if (renew) heartbeatTimer = setInterval(() => {
      if (finished || directChildReaped || renewing || reason !== 'exited') return;
      renewing = true;
      Promise.resolve().then(() => renew({ signal: heartbeatAbort.signal })).then(record => {
        if (!finished && !directChildReaped && reason === 'exited') armLease(record.leaseUntil);
      }).catch(() => { if (!finished && !directChildReaped) stop('lease-lost'); }).finally(() => { renewing = false; });
    }, heartbeatMs);
    child.stdin.end(prompt);
    if (signal?.aborted) abort();
  });
  return { pid: child?.pid ?? null, exitCode, signal: exitSignal, reason, directChildReaped,
    stdoutBytes, stderrBytes, startedAt, endedAt: new Date().toISOString() };
}
