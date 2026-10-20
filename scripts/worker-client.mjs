// Local transport only. Board data never selects an executable or provider.
export function localWorkerOrigin(origin = 'http://127.0.0.1:5173') {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Use a local HTTP origin.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Use a local HTTP origin, with no path or credentials.');
  return url.origin;
}
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Local worker API returned no data.');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Local worker API response exceeds its bound.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
export function workerClient(origin, fetcher = fetch, { deadline = Infinity } = {}) {
  const base = localWorkerOrigin(origin);
  async function request(path, init = {}) {
    const remaining = Math.min(8000, deadline - Date.now());
    if (remaining < 1) throw new Error('Worker invocation deadline reached.');
    let status;
    try {
      const response = await fetcher(`${base}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.any([init.signal, AbortSignal.timeout(Math.ceil(remaining))].filter(Boolean)),
      });
      if (!response.ok) { status = response.status; await response.body?.cancel(); throw new Error('HTTP failure'); }
      return await boundedJson(response);
    } catch { throw new Error(`Local worker API request failed${status ? ` (HTTP ${status})` : ''}; no provider fallback was attempted.`); }
  }
  async function post(command, input, options = {}) {
    const session = await request('/api/session', options);
    if (typeof session.token !== 'string' || !session.token || session.token.length > 1024)
      throw new Error('Local worker API session is unavailable.');
    return request(`/api/team/${command}`, {
      ...options, method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json',
        'X-Merge-Monitor-Token': session.token }, body: JSON.stringify(input),
    });
  }
  return {
    inbox: input => request(`/api/team/inbox?${new URLSearchParams(input)}`),
    ...Object.fromEntries(['claim', 'start', 'renew', 'finish', 'cancel', 'abandon'].map(command =>
      [command, (input, options) => post(command, input, options)])),
  };
}
