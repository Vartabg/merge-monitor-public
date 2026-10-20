import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardClient } from './board-client.mjs';
import { workerClient } from './worker-client.mjs';
import { CODEX_BOUNDARY_CODE, codexAvailability, executeCodex, requireCodexBoundary } from './worker-codex.mjs';
import { cleanSummary, privateResults, receiptPath, workerUuid, writeReceipt } from './worker-files.mjs';
import { parseWorkerArgs, validateWorkerOptions } from './worker-options.mjs';
export { parseWorkerArgs } from './worker-options.mjs';

function boundRun(record, options, assignment, runId) {
  if (!record || !workerUuid.test(record.runId) || (runId && record.runId !== runId) ||
      record.project !== options.project || record.agent !== options.agent || record.assignmentId !== assignment.id)
    throw new Error('The worker API returned a mismatched run.');
  return record;
}
function activeRun(record, options, assignment, phase, runId) {
  boundRun(record, options, assignment, runId);
  if (record.assignmentRevision !== assignment.revision || record.phase !== phase ||
      !Number.isFinite(Date.parse(record.leaseUntil)) || Date.parse(record.leaseUntil) <= Date.now())
    throw new Error('The worker API returned a changed or expired run.');
  return record;
}
function ownedAssignment(inbox, options) {
  if (inbox?.version !== 1 || inbox.project !== options.project || inbox.agent !== options.agent || !Array.isArray(inbox.assignments))
    throw new Error('The worker inbox does not match this project and agent.');
  const matches = inbox.assignments.filter(value => value.id === options.assignmentId), assignment = matches[0];
  if (matches.length !== 1 || assignment.project !== options.project || assignment.owner !== options.agent ||
      assignment.status !== 'queued' || !Number.isSafeInteger(assignment.revision) || assignment.revision < 1 ||
      typeof assignment.reviewer !== 'string' || !assignment.reviewer || assignment.reviewer.toLowerCase() === options.agent.toLowerCase())
    throw new Error('Choose one queued owned assignment with a different reviewer.');
  for (const [key, limit] of [['title', 120], ['purpose', 800], ['scope', 1600], ['acceptance', 1600]])
    if (typeof assignment[key] !== 'string' || assignment[key].length > limit) throw new Error('Assignment task fields are invalid.');
  return structuredClone(assignment);
}
function evidenceOnly(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const reasons = ['exited', 'timeout', 'lease-lost', 'cancelled', 'output-limit', 'spawn-failed',
    'malformed-result', 'execution-error', 'start-failed', 'descendant-uncertain'];
  const date = input => typeof input === 'string' && Number.isFinite(Date.parse(input)) && new Date(input).toISOString() === input ? input : null;
  return { directChildReaped: value.directChildReaped === true, startedAt: date(value.startedAt), endedAt: date(value.endedAt), reason: reasons.includes(value.reason) ? value.reason : 'execution-error',
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
    signal: typeof value.signal === 'string' && /^SIG[A-Z0-9]{1,12}$/.test(value.signal) ? value.signal : null,
    pid: Number.isSafeInteger(value.pid) && value.pid > 0 ? value.pid : null,
    outputBytes: { stdout: Number.isSafeInteger(value.stdoutBytes) ? value.stdoutBytes : 0,
      stderr: Number.isSafeInteger(value.stderrBytes) ? value.stderrBytes : 0 } };
}
export async function runWorker(options, dependencies = {}) {
  const deadline = Date.now() + options.seconds * 1000;
  await validateWorkerOptions(options);
  const client = dependencies.client || workerClient(options.origin, fetch, { deadline });
  const boundedFetch = (url, init = {}) => fetch(url, { ...init,
    signal: AbortSignal.any([init.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))].filter(Boolean)) });
  const checkIn = dependencies.checkIn || (input => boardClient(options.origin, boundedFetch)('check-in', input));
  const execute = dependencies.execute || executeCodex, signal = dependencies.signal;
  const presence = { project: options.project, agent: options.agent, task: 'One explicit bounded read-only assignment',
    scope: 'Fixed ephemeral Codex adapter; no edits, services, provider fallback or existing-chat dispatch.' };
  let checkedIn = false;
  try {
    await checkIn({ ...presence, state: 'working' }); checkedIn = true;
    requireCodexBoundary(dependencies.availability ?? codexAvailability());
    const directory = await privateResults(options.resultDir);
    const assignment = ownedAssignment(await client.inbox({ project: options.project, agent: options.agent }), options);
    if (signal?.aborted || Date.now() >= deadline - 2000) throw new Error('Worker stopped before claim.');
    const claimRequestId = randomUUID();
    const run = boundRun(await client.claim({ project: options.project, agent: options.agent,
      assignmentId: assignment.id, requestId: claimRequestId }), options, assignment);
    const identity = { project: options.project, agent: options.agent, runId: run.runId };
    let result, launched = false;
    try {
      activeRun(run, options, assignment, 'claimed');
      if (signal?.aborted) throw new Error('Cancelled before launch.');
      const active = activeRun(await client.start({ ...identity, adapter: options.adapter }), options, assignment, 'running', run.runId);
      const renew = async (requestOptions) => activeRun(await client.renew(identity, requestOptions), options, assignment, 'running', run.runId);
      launched = true;
      result = await execute({ cwd: options.cwd, assignment, deadline: deadline - 2000,
        renew, signal, leaseUntil: active.leaseUntil });
    } catch {
      result = { ok: false, summary: launched ? 'Worker could not complete its bounded inspection.' : 'Worker stopped before child launch.',
        evidence: { reason: launched ? 'execution-error' : 'start-failed' } };
    }
    const evidence = evidenceOnly(result.evidence);
    const uncertain = evidence.reason === 'descendant-uncertain';
    const cancelled = signal?.aborted || ['lease-lost', 'cancelled', 'start-failed'].includes(evidence.reason);
    const success = !cancelled && !uncertain && evidence.directChildReaped && result.ok === true && evidence.exitCode === 0 && evidence.reason === 'exited' &&
      typeof result.summary === 'string' && result.summary.trim() && result.summary.length <= 1200;
    const workerStatus = success ? 'review' : 'blocked';
    const summary = cleanSummary(result.summary) || 'Worker returned no usable summary.';
    const intendedPath = receiptPath(directory, run.runId);
    const report = uncertain ? { operation: 'abandon', input: { ...identity, summary } } :
      cancelled ? { operation: 'cancel', input: { ...identity, summary } } :
      { operation: 'finish', input: { ...identity, status: workerStatus, summary, artifacts: [intendedPath], requestId: randomUUID() } };
    const receipt = { version: 1, ...identity, assignmentId: assignment.id, assignmentRevision: assignment.revision,
      adapter: 'codex', cwd: options.cwd, status: workerStatus, summary, evidence, claimRequestId, report,
      observedAt: new Date().toISOString(), limits: { wallClockSeconds: options.seconds, tokenOrDollarCap: false } };
    let path;
    try { path = await writeReceipt(directory, receipt); }
    catch {
      await client[uncertain ? 'abandon' : 'cancel']({ ...identity, summary: uncertain
        ? 'Descendant stop is unverified and the receipt could not be saved. Keep this reservation until verified-stop cancellation.'
        : 'Worker stopped, but receipt could not be saved. Inspect this run before retrying.' }).catch(() => {});
      throw new Error('The worker receipt could not be saved; inspect the project inbox.');
    }
    let publication = 'unconfirmed';
    try {
      const finished = boundRun(await client[report.operation](report.input), options, assignment, run.runId);
      if (finished.phase !== (uncertain ? 'expired' : cancelled ? 'cancelled' : workerStatus)) throw new Error('Unexpected final phase.');
      publication = 'confirmed';
    } catch { /* Preserve the receipt and its stable request IDs for explicit delivery retry. */ }
    const status = publication === 'confirmed' ? workerStatus : 'blocked';
    const output = { runId: run.runId, status, workerStatus, publication, summary, artifacts: [path] };
    if (uncertain) output.nextAction = 'Descendant stop is unverified. Keep the reservation until an explicit verified-stop cancellation; do not dispatch replacement work.';
    else if (publication !== 'confirmed') output.nextAction = 'Retry the saved receipt report with its original request identity; inspect the inbox before dispatching replacement work.';
    try { await checkIn({ ...presence, state: status === 'review' ? 'done' : 'blocked' }); }
    catch { output.presenceUpdated = false; }
    return output;
  } catch (error) {
    if (checkedIn) await checkIn({ ...presence, state: 'blocked' }).catch(() => {});
    if (error.code === CODEX_BOUNDARY_CODE) throw error;
    // Carry a coarse cause without exposing untrusted upstream bodies or stacks.
    const failure = new Error('Worker preflight or dispatch failed; inspect the project inbox before retrying.',
      { cause: { code: 'WORKER_OPERATION_UNCONFIRMED' } });
    throw failure;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await runWorker(await parseWorkerArgs(process.argv.slice(2)), { signal: controller.signal });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'review' || result.publication !== 'confirmed') process.exitCode = 1;
  } catch (error) {
    console.error(error.code === CODEX_BOUNDARY_CODE ? `[Team worker] ${error.message}` :
      '[Team worker] Invocation failed; no successful handoff is confirmed. Inspect the project inbox before retrying.');
    process.exitCode = 2;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
