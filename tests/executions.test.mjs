import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,stat,writeFile,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createExecutionStore} from '../server/executions.mjs';

const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function setup(options={}) {
  const root=await mkdtemp(join(tmpdir(),'execution-store-'));roots.push(root);
  const path=join(root,'private','runs.json');let now=Date.parse('2026-10-19T12:00:00Z');
  const store=await createExecutionStore(path,{clock:()=>now,leaseMs:1000,...options});
  const assignment={id:randomUUID(),revision:1,project:'studio',owner:'worker-a',status:'queued'};
  const input={project:'studio',agent:'worker-a',assignmentId:assignment.id,requestId:randomUUID()};
  return {root,path,store,assignment,input,tick:ms=>{now+=ms;},clock:()=>now};
}
const identity=run=>({project:run.project,agent:run.agent,runId:run.runId});
const completion=run=>({...identity(run),status:'review',summary:'Verified the scoped change',artifacts:['/synthetic/result.md'],requestId:randomUUID()});

it('reports retained global usage without reclaiming terminal evidence',async()=>{
  const {store,input,assignment}=await setup();
  expect(store.capacity()).toEqual({used:0,limit:500});
  const run=await store.claim(input,assignment);
  await store.cancel({...identity(run),summary:'Stopped'});
  const capacity=store.capacity();capacity.used=0;
  expect(store.capacity()).toEqual({used:1,limit:500});
});
it('two competing claims produce exactly one persisted reservation',async()=>{
  const {store,input,assignment,path}=await setup();
  const results=await Promise.allSettled([store.claim(input,assignment),store.claim({...input,requestId:randomUUID()},assignment)]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(results.find(result=>result.status==='rejected').reason.statusCode).toBe(409);
  expect(store.list('studio')).toHaveLength(1);
  expect(JSON.parse(await readFile(path,'utf8')).runs).toHaveLength(1);
});
it('claim retry is exact and durable after assignment status changes',async()=>{
  const {store,input,assignment,path,clock}=await setup();const run=await store.claim(input,assignment);
  expect(await store.claim(input,{...assignment,status:'working',revision:2})).toEqual(run);
  const reopened=await createExecutionStore(path,{clock,leaseMs:1000});
  expect(await reopened.claim(input,{...assignment,status:'working'})).toEqual(run);
  await expect(reopened.claim({...input,agent:'other'},{...assignment,owner:'other'})).rejects.toMatchObject({statusCode:409});
});
it('rejects owner/project/id mismatch and nonqueued new work',async()=>{
  const {store,input,assignment}=await setup();
  for(const changed of [{owner:'other'},{project:'other'},{id:randomUUID()},{status:'accepted'}])
    await expect(store.claim(input,{...assignment,...changed})).rejects.toMatchObject({statusCode:409});
  expect(store.list('studio')).toEqual([]);
});
it('expires conservatively, reserves capacity and fences late start/renew/finish',async()=>{
  const {store,input,assignment,tick}=await setup({maxActive:1});const run=await store.claim(input,assignment);tick(1000);
  expect(store.list('studio')[0].phase).toBe('expired');
  await expect(store.start({...identity(run),adapter:'native'})).rejects.toMatchObject({statusCode:409});
  await expect(store.renew(identity(run))).rejects.toMatchObject({statusCode:409});
  await expect(store.finish(completion(run))).rejects.toMatchObject({statusCode:409});
  const other={...assignment,id:randomUUID()};
  await expect(store.claim({...input,assignmentId:other.id,requestId:randomUUID()},other)).rejects.toMatchObject({statusCode:409});
  await store.cancel({...identity(run),summary:'Operator stopped the old worker'});
  await expect(store.finish(completion(run))).rejects.toMatchObject({statusCode:409});
  expect((await store.claim({...input,assignmentId:other.id,requestId:randomUUID()},other)).phase).toBe('claimed');
});
it('start and renewal are client reports; finish retries persist and mismatches conflict',async()=>{
  const {store,input,assignment,tick,path,clock}=await setup();const run=await store.claim(input,assignment);
  const started=await store.start({...identity(run),adapter:'native-host'});expect(started.phase).toBe('running');expect(started.adapter).toBe('native-host');
  tick(500);const renewed=await store.renew(identity(run));expect(Date.parse(renewed.leaseUntil)).toBe(clock()+1000);
  const done=completion(run),finished=await store.finish(done);expect(finished.finishRequestId).toBe(done.requestId);
  expect(await store.finish(done)).toEqual(finished);
  const reopened=await createExecutionStore(path,{clock});expect(await reopened.finish(done)).toEqual(finished);
  await expect(store.finish({...done,summary:'Different result'})).rejects.toMatchObject({statusCode:409});
  await expect(store.finish({...done,requestId:randomUUID()})).rejects.toMatchObject({statusCode:409});
});
it('failed persistence leaves published state and saved bytes unchanged, then recovers',async()=>{
  const {store,input,assignment,path}=await setup();const run=await store.claim(input,assignment),before=await readFile(path,'utf8');
  await chmod(join(path,'..'),0o750);
  await expect(store.start({...identity(run),adapter:'native'})).rejects.toThrow();
  expect(store.list('studio')).toEqual([run]);expect(await readFile(path,'utf8')).toBe(before);
  await chmod(join(path,'..'),0o700);expect((await store.start({...identity(run),adapter:'native'})).phase).toBe('running');
});
it('persists private files and rejects corrupt state without replacing it',async()=>{
  const {store,input,assignment,path}=await setup();await store.claim(input,assignment);
  expect((await stat(path)).mode&0o777).toBe(0o600);expect((await stat(join(path,'..'))).mode&0o777).toBe(0o700);
  await writeFile(path,'{"version":1,"runs":[{}]}');
  await expect(createExecutionStore(path)).rejects.toThrow();expect(await readFile(path,'utf8')).toBe('{"version":1,"runs":[{}]}');
});
it('enforces three active reservations across projects, releases only explicit terminal runs',async()=>{
  const {store,input,assignment}=await setup();const runs=[];
  for(let index=0;index<3;index++) {const item={...assignment,id:randomUUID(),project:'studio-'+index};runs.push(await store.claim({...input,project:item.project,assignmentId:item.id,requestId:randomUUID()},item));}
  await expect(store.claim(input,assignment)).rejects.toMatchObject({statusCode:409});
  await store.start({...identity(runs[0]),adapter:'native'});await store.finish({...completion(runs[0]),status:'blocked'});
  expect((await store.claim(input,assignment)).phase).toBe('claimed');expect(store.list('studio')).toHaveLength(1);
});
it('fences every mutation by run id, project and agent',async()=>{
  const {store,input,assignment}=await setup(),run=await store.claim(input,assignment);
  await store.start({...identity(run),adapter:'native'});
  for(const changed of [{project:'another-project'},{agent:'another-worker'}]) {
    await expect(store.start({...identity(run),...changed,adapter:'native'})).rejects.toMatchObject({statusCode:409});
    await expect(store.renew({...identity(run),...changed})).rejects.toMatchObject({statusCode:409});
    await expect(store.finish({...completion(run),...changed})).rejects.toMatchObject({statusCode:409});
    await expect(store.cancel({...identity(run),...changed,summary:'Stop'})).rejects.toMatchObject({statusCode:409});
  }
  await expect(store.renew({...identity(run),runId:randomUUID()})).rejects.toMatchObject({statusCode:404});
  expect(store.list('studio')[0].phase).toBe('running');
});
it('rejects malformed commands and reused operation ids before changing state',async()=>{
  const {store,input,assignment}=await setup();
  for(const changed of [{requestId:'bad'},{project:'bad\u0000name'},{extra:'unknown'}])
    await expect(store.claim({...input,...changed},assignment)).rejects.toMatchObject({statusCode:400});
  const run=await store.claim(input,assignment);await store.start({...identity(run),adapter:'native'});
  await expect(store.finish({...completion(run),requestId:input.requestId})).rejects.toMatchObject({statusCode:409});
  await expect(store.finish({...completion(run),summary:'x'.repeat(1201)})).rejects.toMatchObject({statusCode:400});
  await expect(store.finish({...completion(run),artifacts:['javascript:bad']})).rejects.toMatchObject({statusCode:400});
  expect(store.list('studio')[0].phase).toBe('running');
});
it('returns isolated observations without persisting derived expiration',async()=>{
  const {store,input,assignment,path,tick}=await setup(),run=await store.claim(input,assignment);
  const bytes=await readFile(path,'utf8');run.phase='cancelled';store.list('studio')[0].agent='other';
  tick(1000);expect(store.list('studio')[0].phase).toBe('expired');
  expect(store.list('studio')[0].agent).toBe(input.agent);expect(await readFile(path,'utf8')).toBe(bytes);
  const reopened=await createExecutionStore(path,{clock:()=>Date.parse(run.leaseUntil)});
  expect(reopened.list('studio')[0].phase).toBe('expired');
});
it('keeps claim/start/cancel exact retries safe and forbids new results after cancellation',async()=>{
  const {store,input,assignment}=await setup(),run=await store.claim(input,assignment);
  const started=await store.start({...identity(run),adapter:'native'});
  expect(await store.start({...identity(run),adapter:'native'})).toEqual(started);
  await expect(store.start({...identity(run),adapter:'different'})).rejects.toMatchObject({statusCode:409});
  const stopped=await store.cancel({...identity(run),summary:'Worker stopped'});
  expect(await store.cancel({...identity(run),summary:'Worker stopped'})).toEqual(stopped);
  expect(await store.claim(input,assignment)).toEqual(stopped);
  await expect(store.renew(identity(run))).rejects.toMatchObject({statusCode:409});
  await expect(store.finish(completion(run))).rejects.toMatchObject({statusCode:409});
  const replacement=await store.claim({...input,requestId:randomUUID()},assignment);
  expect(replacement.runId).not.toBe(run.runId);
});
it('refuses nonprivate files/directories and symlink execution parent without chmod',async()=>{
  const {root,path}=await setup(),privateDir=join(path,'..');
  await chmod(privateDir,0o750);await expect(createExecutionStore(path)).rejects.toThrow(/private/);
  expect((await stat(privateDir)).mode&0o777).toBe(0o750);await chmod(privateDir,0o700);
  await writeFile(path,'{"version":1,"runs":[]}',{mode:0o644});
  await expect(createExecutionStore(path)).rejects.toThrow(/private/);await rm(path);
  const linked=join(root,'linked');await symlink(privateDir,linked);
  await expect(createExecutionStore(join(linked,'runs.json'))).rejects.toThrow(/nonsymlink/);
});
it('fails closed for duplicate ids, phase inconsistencies and over500 saved runs',async()=>{
  const {store,input,assignment,path}=await setup(),run=await store.claim(input,assignment);
  for(const runs of [[run,run],[{...run,phase:'running'}],[{...run,finishRequestId:randomUUID()}],
    Array.from({length:501},()=>({...run,runId:randomUUID(),assignmentId:randomUUID(),requestId:randomUUID()}))]) {
    const bytes=JSON.stringify({version:1,runs});await writeFile(path,bytes);
    await expect(createExecutionStore(path)).rejects.toThrow();expect(await readFile(path,'utf8')).toBe(bytes);
  }
});
it('refuses record501 after500 valid terminal runs without pruning evidence',async()=>{
  const {store,input,assignment,path}=await setup(),run=await store.claim(input,assignment);
  const runs=Array.from({length:500},()=>({...run,runId:randomUUID(),assignmentId:randomUUID(),requestId:randomUUID(),phase:'cancelled',summary:'Explicitly cancelled'}));
  await writeFile(path,JSON.stringify({version:1,runs}));const reopened=await createExecutionStore(path);
  await expect(reopened.claim(input,assignment)).rejects.toMatchObject({statusCode:409});expect(reopened.list('studio')).toHaveLength(500);
});
it('abandon immediately fences uncertain work and reserves its assignment/capacity until explicit cancel',async()=>{
  const {store,input,assignment,path,clock,tick}=await setup({maxActive:1}),run=await store.claim(input,assignment);
  await store.start({...identity(run),adapter:'native'});
  const request={...identity(run),summary:'Detached descendant cleanup cannot be confirmed'};
  const abandoned=await store.abandon(request);
  expect(abandoned.phase).toBe('expired');expect(abandoned.leaseUntil).toBe(new Date(clock()).toISOString());
  expect(abandoned.summary).toBe(request.summary);tick(500);
  expect(await store.abandon(request)).toEqual(abandoned);
  await expect(store.start({...identity(run),adapter:'native'})).rejects.toMatchObject({statusCode:409});
  await expect(store.renew(identity(run))).rejects.toMatchObject({statusCode:409});
  await expect(store.finish(completion(run))).rejects.toMatchObject({statusCode:409});
  const reopened=await createExecutionStore(path,{clock,maxActive:1});
  expect(await reopened.abandon(request)).toEqual(abandoned);
  await expect(reopened.claim({...input,requestId:randomUUID()},assignment)).rejects.toMatchObject({statusCode:409});
  const other={...assignment,id:randomUUID()};
  await expect(reopened.claim({...input,assignmentId:other.id,requestId:randomUUID()},other)).rejects.toMatchObject({statusCode:409});
  await reopened.cancel({...identity(run),summary:'External check confirmed all work stopped'});
  expect((await reopened.claim({...input,requestId:randomUUID()},assignment)).phase).toBe('claimed');
});
it('abandon accepts claimed or already expired work, rejects terminal states and fences wrong identity',async()=>{
  for(const mode of ['claimed','expired','cancelled','review','blocked']) {
    const {store,input,assignment,tick}=await setup(),run=await store.claim(input,assignment);
    if(mode==='expired')tick(1000);
    if(mode==='cancelled')await store.cancel({...identity(run),summary:'Stopped'});
    if(['review','blocked'].includes(mode)) {await store.start({...identity(run),adapter:'native'});await store.finish({...completion(run),status:mode});}
    const request={...identity(run),summary:'Cannot confirm all work stopped'};
    if(['claimed','expired'].includes(mode)) {
      for(const changed of [{project:'other'},{agent:'other'}])
        await expect(store.abandon({...request,...changed})).rejects.toMatchObject({statusCode:409});
      expect((await store.abandon(request)).phase).toBe('expired');
      await expect(store.abandon({...request,extra:true})).rejects.toMatchObject({statusCode:400});
    } else await expect(store.abandon(request)).rejects.toMatchObject({statusCode:409});
  }
});
