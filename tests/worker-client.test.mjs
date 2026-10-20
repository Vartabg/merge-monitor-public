import { expect, it, vi } from 'vitest';
import { workerClient } from '../scripts/worker-client.mjs';
it('rejects remote or ambiguous origins without requesting credentials',()=>{
  const fetcher=vi.fn();
  for(const origin of ['https://example.com','http://localhost@evil.invalid','http://localhost/a','http://127.0.0.1?x=1'])
    expect(()=>workerClient(origin,fetcher)).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('uses exact named endpoints, local token protection, and no redirects',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({version:1})))
    .mockResolvedValueOnce(new Response(JSON.stringify({token:'synthetic-token'})))
    .mockResolvedValueOnce(new Response(JSON.stringify({runId:'synthetic-run'})));
  const client=workerClient('http://127.0.0.1:5173',fetcher);
  await client.inbox({project:'a & b',agent:'worker'});
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:5173/api/team/inbox?project=a+%26+b&agent=worker');
  expect(await client.claim({project:'a',agent:'worker',assignmentId:'id',requestId:'req'})).toEqual({runId:'synthetic-run'});
  expect(fetcher.mock.calls[2][1]).toMatchObject({method:'POST',redirect:'error',headers:{Origin:'http://127.0.0.1:5173','X-Merge-Monitor-Token':'synthetic-token'}});
});
it('does not expose untrusted server errors or follow redirect responses',async()=>{
  const client=workerClient(undefined,async()=>new Response(JSON.stringify({error:'secret synthetic-content'}),{status:500}));
  await expect(client.inbox({project:'p',agent:'a'})).rejects.toThrow('Local worker API request failed');
  await expect(client.inbox({project:'p',agent:'a'})).rejects.not.toThrow('synthetic-content');
});
