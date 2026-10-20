import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const workerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanSummary(value) {
  return String(value).split('').filter(char => {
    const code = char.codePointAt(0); return code >= 32 && code !== 127 || char === '\n' || char === '\t';
  }).join('')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|gh[pousr]_[a-zA-Z0-9_]{8,}|github_pat_[a-zA-Z0-9_]{8,})\b/g, '[redacted]')
    .replace(/\b(?:Bearer\s+)[a-zA-Z0-9._~+/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .trim().slice(0, 1200);
}
export async function readWorkerResult(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384 || stat.uid !== process.getuid()) throw new Error('Invalid result.');
    const buffer = Buffer.alloc(16385);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > 16384) throw new Error('Invalid result.');
    const value = JSON.parse(buffer.subarray(0, total).toString('utf8'));
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'artifacts,summary' ||
        typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1200 ||
        !Array.isArray(value.artifacts) || value.artifacts.length !== 0) throw new Error('Invalid result.');
    const summary = cleanSummary(value.summary);
    if (!summary) throw new Error('Invalid result.');
    return { summary, artifacts: [] };
  } finally { await file.close(); }
}
export async function privateResults(path) {
  if (!path) return mkdtemp(join(tmpdir(), 'merge-monitor-receipt-'));
  if (!isAbsolute(path)) throw new Error('Use an absolute result directory.');
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077))
    throw new Error('Result directory must be private, owned, and not a symlink.');
  return path;
}
export function receiptPath(directory, runId) { return join(directory, `run-${runId}.json`); }
export async function writeReceipt(directory, value) {
  const path = receiptPath(directory, value.runId);
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
  finally { await file.close(); }
  return path;
}
