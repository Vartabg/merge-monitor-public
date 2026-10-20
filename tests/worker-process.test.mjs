import { expect, it, vi } from 'vitest';
import { runOwnedChild } from '../scripts/worker-process.mjs';
const spec=code=>({file:process.execPath,args:['-e',code],cwd:'/tmp'});
it('runs a real fake child, records exit, and captures no raw transcript',async()=>{
  const result=await runOwnedChild(spec('process.stdout.write("private synthetic output")'),{prompt:'synthetic',deadline:Date.now()+2000});
  expect(result).toMatchObject({exitCode:0,reason:'exited',stdoutBytes:24});
  expect(JSON.stringify(result)).not.toContain('private synthetic');
});
it('heartbeats only while the owned child is alive',async()=>{
  const renew=vi.fn(async()=>({leaseUntil:new Date(Date.now()+2000).toISOString()}));
  const result=await runOwnedChild(spec('setTimeout(()=>{},100)'),{deadline:Date.now()+2000,renew,heartbeatMs:20});
  const count=renew.mock.calls.length;expect(count).toBeGreaterThan(0);expect(result.exitCode).toBe(0);
  await new Promise(resolve=>setTimeout(resolve,50));expect(renew).toHaveBeenCalledTimes(count);
});
it.each(['timeout','lease-lost','cancelled','output-limit'])('kills and reaps its child on %s',async reason=>{
  const controller=new AbortController();
  const renew=reason==='lease-lost'?async()=>{throw Error('synthetic');}:undefined;
  if(reason==='cancelled')setTimeout(()=>controller.abort(),40);
  const code=reason==='output-limit'?'process.stdout.write("x".repeat(200000));setInterval(()=>{},1000)':'setInterval(()=>{},1000)';
  const result=await runOwnedChild(spec(code),{deadline:Date.now()+(reason==='timeout'?60:2000),renew,heartbeatMs:20,signal:controller.signal});
  expect(result.reason).toBe(reason);expect(result.exitCode).not.toBe(0);
  expect(()=>process.kill(result.pid,0)).toThrow();
});
it('reports spawn failure without exposing exception text',async()=>{
  const result=await runOwnedChild({file:'/no/such/synthetic-worker',args:[],cwd:'/tmp'},{deadline:Date.now()+1000});
  expect(result.reason).toBe('spawn-failed');expect(result.exitCode).not.toBe(0);
});
it('cancels its owned group while leaving a separately started sibling alive',async()=>{
  const {spawn}=await import('node:child_process');
  const sibling=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});
  try{
    const result=await runOwnedChild(spec('setInterval(()=>{},1000)'),{deadline:Date.now()+60});
    expect(result.reason).toBe('timeout');expect(()=>process.kill(sibling.pid,0)).not.toThrow();
  }finally{
    const done=new Promise(resolve=>sibling.once('close',resolve));
    process.kill(-sibling.pid,'SIGKILL');await done;
  }
});
it('bounds teardown after direct exit when an escaped fixture descendant holds the pipes',async()=>{
  const {mkdtemp,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const directory=await mkdtemp(join(tmpdir(),'worker-descendant-'));
  const pidPath=join(directory,'pid'),readyPath=join(directory,'ready');
  let descendant;
  try{
    const descendantCode='setTimeout(()=>{},10000);process.send("ready",()=>process.disconnect());';
    const code=`const fs=require("node:fs");
const c=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(descendantCode)}],
  {detached:true,stdio:["ignore",1,2,"ipc"]});
fs.writeFileSync(process.argv[1],String(c.pid));
c.once("message",()=>{fs.writeFileSync(process.argv[2],String(Date.now()));c.unref();process.exit(0);});`;
    // Startup has its own generous allowance. Measure teardown only after the
    // fixture confirms its escaped child is alive and the direct parent exits.
    const result=await runOwnedChild({file:process.execPath,args:['-e',code,pidPath,readyPath],cwd:'/tmp'},
      {deadline:Date.now()+5000});
    const returnedAt=Date.now(),releasedAt=Number(await readFile(readyPath,'utf8'));
    descendant=Number(await readFile(pidPath,'utf8'));
    expect(result).toMatchObject({reason:'descendant-uncertain',exitCode:0,directChildReaped:true});
    expect(releasedAt).toBeGreaterThan(0);expect(returnedAt-releasedAt).toBeLessThan(1000);
    expect(Number.isSafeInteger(descendant)&&descendant>0).toBe(true);
    expect(()=>process.kill(descendant,0)).not.toThrow();
  }finally{
    if(!descendant)descendant=Number(await readFile(pidPath,'utf8').catch(()=>''));
    if(Number.isSafeInteger(descendant)&&descendant>0){try{process.kill(-descendant,'SIGKILL');}catch{/* Fixture already exited. */}}
    await rm(directory,{recursive:true,force:true});
  }
},8000);
