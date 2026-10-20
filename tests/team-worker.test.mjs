import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkerArgs, runWorker } from '../scripts/team-worker.mjs';

const assignmentId='b8e8d664-dc87-49e9-95b0-b8690c826e60';
const runId='900bb36a-d35a-4251-952d-3ecfdc9f0e4c';
const assignment={id:assignmentId,project:'project',owner:'worker',reviewer:'reviewer',revision:1,
  title:'Inspect one file',purpose:'Read only',scope:'README.md',acceptance:'Compact finding',budget:'10 seconds',status:'queued'};
function context(root, overrides={}) {
  const record={runId,assignmentId,assignmentRevision:1,project:'project',agent:'worker',phase:'claimed',leaseUntil:new Date(Date.now()+60000).toISOString()};
  const client={inbox:vi.fn(async()=>({version:1,project:'project',agent:'worker',assignments:[assignment],requests:[],runs:[]})),
    claim:vi.fn(async()=>record),start:vi.fn(async()=>({...record,phase:'running'})),
    renew:vi.fn(async()=>({...record,phase:'running'})),finish:vi.fn(async input=>({...record,phase:input.status})),cancel:vi.fn(async()=>({...record,phase:'cancelled'}))};
  const checkIn=vi.fn(async()=>{}),execute=vi.fn(async()=>({ok:true,summary:'One bounded finding.',evidence:{exitCode:0,reason:'exited',directChildReaped:true}}));
  return {options:{project:'project',agent:'worker',assignmentId,cwd:root,adapter:'codex',seconds:10,resultDir:root},
    deps:{client,checkIn,execute,availability:{available:true},...overrides},client,checkIn,execute};
}
it('rejects unsafe or incomplete CLI options before execution', async()=>{
  const base=['once','--project','project','--agent','worker','--assignment',assignmentId,'--cwd','/tmp','--adapter','codex','--seconds','10'];
  expect((await parseWorkerArgs(base)).seconds).toBe(10);
  for(const extra of [['--seconds','181'],['--adapter','shell'],['--cwd','relative'],['--origin','https://example.com'],['--result-dir','relative'],['--model','other']])
    await expect(parseWorkerArgs([...base,...extra])).rejects.toThrow();
  await expect(parseWorkerArgs(base.slice(1))).rejects.toThrow();
});
it('checks in, claims one owned immutable assignment, and hands only verified result to review',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-test-'));
  try{
    const {options,deps,client,checkIn,execute}=context(root);
    const result=await runWorker(options,deps);
    expect(result.status).toBe('review');
    expect(checkIn.mock.invocationCallOrder[0]).toBeLessThan(client.claim.mock.invocationCallOrder[0]);
    expect(execute.mock.calls[0][0].assignment).toEqual(assignment);
    expect(client.claim).toHaveBeenCalledTimes(1);
    expect(client.finish.mock.calls[0][0]).toMatchObject({runId,status:'review',summary:'One bounded finding.'});
    const receipt=JSON.parse(await readFile(result.artifacts[0],'utf8'));
    expect(receipt).toMatchObject({version:1,runId,status:'review',evidence:{exitCode:0}});
    expect(receipt.evidence.outputBytes).toEqual({stdout:0,stderr:0});
  }finally{await rm(root,{recursive:true,force:true});}
});
it.each(['timeout','lease-lost','nonzero','malformed-result'])('reports %s as blocked, never review',async reason=>{
  const root=await mkdtemp(join(tmpdir(),'worker-fail-'));
  try{
    const {options,deps,client}=context(root,{execute:async()=>({ok:false,summary:'Worker did not complete.',evidence:{reason,exitCode:1}})});
    expect((await runWorker(options,deps)).status).toBe('blocked');
    if(reason==='lease-lost'){expect(client.cancel).toHaveBeenCalledTimes(1);expect(client.finish).not.toHaveBeenCalled();}
    else expect(client.finish.mock.calls[0][0].status).toBe('blocked');
  }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses a foreign or changed assignment before starting a child',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-owner-'));
  try{
    const {options,deps,client,execute}=context(root);
    client.inbox.mockResolvedValue({version:1,project:'project',agent:'worker',assignments:[{...assignment,owner:'other'}]});
    await expect(runWorker(options,deps)).rejects.toThrow();
    expect(client.claim).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  }finally{await rm(root,{recursive:true,force:true});}
});
it('does not execute after a mismatched claim and reports cancellation without review',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-mismatch-'));
  try{
    const {options,deps,client,execute}=context(root);
    client.claim.mockResolvedValue({runId,project:'other',agent:'worker',assignmentId,assignmentRevision:1});
    await expect(runWorker(options,deps)).rejects.toThrow();expect(execute).not.toHaveBeenCalled();
  }finally{await rm(root,{recursive:true,force:true});}
});
it('preserves a compact receipt and retry identity when final handoff delivery fails',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-publication-'));
  try{
    const {options,deps,client}=context(root);
    client.finish.mockRejectedValue(Error('untrusted synthetic server text'));
    const result=await runWorker(options,deps);
    expect(result).toMatchObject({status:'blocked',workerStatus:'review',publication:'unconfirmed'});
    const receipt=JSON.parse(await readFile(result.artifacts[0],'utf8'));
    expect(receipt.report.input).toEqual(client.finish.mock.calls[0][0]);
    expect(JSON.stringify(result)).not.toContain('untrusted synthetic');
  }finally{await rm(root,{recursive:true,force:true});}
});
it('cancels an owned failed start before any child launch and preserves a blocked receipt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-start-'));
  try{
    const {options,deps,client,execute}=context(root);
    client.start.mockRejectedValue(Error('synthetic'));
    expect((await runWorker(options,deps)).status).toBe('blocked');
    expect(execute).not.toHaveBeenCalled();expect(client.finish).not.toHaveBeenCalled();
    expect(client.cancel).toHaveBeenCalledTimes(1);
  }finally{await rm(root,{recursive:true,force:true});}
});
it('independently rejects a false adapter success and filters raw evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-false-success-'));
  try{
    const {options,deps,client}=context(root,{execute:async()=>({ok:true,summary:'api_key=<example>',
      evidence:{reason:'exited',exitCode:1,stdout:'private synthetic log'}})});
    const result=await runWorker(options,deps);expect(result.status).toBe('blocked');
    const receipt=await readFile(result.artifacts[0],'utf8');
    expect(receipt).not.toContain('private synthetic log');expect(receipt).not.toContain('<example>');
    expect(client.finish.mock.calls[0][0].summary).toContain('[redacted]');
  }finally{await rm(root,{recursive:true,force:true});}
});
it('retries the identical saved finish after the store saved it but its response was lost',async()=>{
  const {createExecutionStore}=await import('../server/executions.mjs');
  const root=await mkdtemp(join(tmpdir(),'worker-retry-'));
  try{
    const store=await createExecutionStore(join(root,'runs.json'));
    const {options,deps,client}=context(root);
    client.claim.mockImplementation(input=>store.claim(input,assignment));
    client.start.mockImplementation(input=>store.start(input));
    client.finish.mockImplementationOnce(async input=>{await store.finish(input);throw Error('synthetic response loss');})
      .mockImplementation(input=>store.finish(input));
    const result=await runWorker(options,deps),receipt=JSON.parse(await readFile(result.artifacts[0],'utf8'));
    expect(result.publication).toBe('unconfirmed');
    expect(receipt.report.input).toEqual(client.finish.mock.calls[0][0]);
    expect((await client.finish(receipt.report.input)).phase).toBe('review');
    expect(store.list('project')).toHaveLength(1);
  }finally{await rm(root,{recursive:true,force:true});}
});
it('marks a checked-in actor blocked when inbox preflight fails',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-preflight-'));
  try{
    const {options,deps,client,checkIn}=context(root);
    client.inbox.mockRejectedValue(Error('synthetic failure'));
    await expect(runWorker(options,deps)).rejects.toThrow();
    expect(checkIn.mock.calls.map(([input])=>input.state)).toEqual(['working','blocked']);
    expect(client.claim).not.toHaveBeenCalled();
  }finally{await rm(root,{recursive:true,force:true});}
});
it('abandons an uncertain descendant result and preserves the capacity reservation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-abandon-'));
  try{
    const {options,deps,client}=context(root,{execute:async()=>({ok:false,summary:'Descendant stop is unverified.',
      evidence:{reason:'descendant-uncertain',exitCode:0,directChildReaped:true}})});
    client.abandon=vi.fn(async input=>({runId,assignmentId,project:'project',agent:'worker',phase:'expired',...input}));
    const result=await runWorker(options,deps);
    expect(result).toMatchObject({status:'blocked',publication:'confirmed'});
    expect(client.abandon).toHaveBeenCalledTimes(1);expect(client.finish).not.toHaveBeenCalled();expect(client.cancel).not.toHaveBeenCalled();
    const receipt=JSON.parse(await readFile(result.artifacts[0],'utf8'));expect(receipt.report.operation).toBe('abandon');
  }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps an uncertain reservation even if the receipt cannot be written',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-abandon-disk-'));
  try{
    const {options,deps,client}=context(root,{execute:async()=>({ok:false,summary:'Descendant stop is unverified.',
      evidence:{reason:'descendant-uncertain',exitCode:0,directChildReaped:true}})});
    client.abandon=vi.fn(async input=>({runId,assignmentId,project:'project',agent:'worker',phase:'expired',...input}));
    const obstacle=join(root,`run-${runId}.json`);await writeFile(obstacle,'synthetic existing file');
    await expect(runWorker(options,deps)).rejects.toThrow();
    expect(client.abandon).toHaveBeenCalledTimes(1);expect(client.cancel).not.toHaveBeenCalled();expect(client.finish).not.toHaveBeenCalled();
    expect(await readFile(obstacle,'utf8')).toBe('synthetic existing file');
  }finally{await rm(root,{recursive:true,force:true});}
});
it('fails closed before inbox, claim, start, or provider launch when tool boundaries are unverified',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-gated-'));
  try{
    const {options,deps,client,execute,checkIn}=context(root,{availability:{available:false}});
    await expect(runWorker(options,deps)).rejects.toMatchObject({code:'CODEX_CAPABILITY_BOUNDARY_UNVERIFIED'});
    expect(client.inbox).not.toHaveBeenCalled();expect(client.claim).not.toHaveBeenCalled();expect(client.start).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();expect(checkIn.mock.calls.map(([value])=>value.state)).toEqual(['working','blocked']);
  }finally{await rm(root,{recursive:true,force:true});}
});
