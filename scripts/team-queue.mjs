import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runTeamQueue(args, fetcher = fetch) {
  const [command, ...rest] = args;
  if (!['list', 'create', 'update'].includes(command))
    throw new Error("Use: node scripts/team-queue.mjs list|create|update [--origin http://127.0.0.1:5173] [--input assignment.json]");
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--origin', '--input'].includes(rest[i]) || !rest[i + 1] || options[rest[i]])
      throw new Error("Use each --origin or --input option once, followed by its value.");
    options[rest[i]] = rest[i + 1];
  }
  const url = new URL(options['--origin'] || 'http://127.0.0.1:5173');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error("Use the local Merge Monitor HTTP origin with no path or credentials.");
  if ((command === 'list') === Boolean(options['--input']))
    throw new Error("Create and update require --input; list does not accept an input file.");
  async function request(path, init = {}) {
    const response = await fetcher(`${url.origin}${path}`, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The queue request failed. Check the local service.');
    return value;
  }
  if (command === 'list') return request('/api/assignments');
  const input = JSON.parse(await readFile(resolve(options['--input']), 'utf8'));
  const { token } = await request('/api/session');
  return request(command === 'create' ? '/api/assignments' : '/api/assignments/update', {
    method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json', 'X-Merge-Monitor-Token': token },
    body: JSON.stringify(input),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runTeamQueue(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(`[Team queue] Request failed → ${error.message}`); process.exitCode = 1; }
}
