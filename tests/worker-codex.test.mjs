import { expect, it } from 'vitest';
import { access, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_EXECUTABLE, codexAvailability, codexSpec, executeCodex, scopedPrompt } from '../scripts/worker-codex.mjs';
import { readWorkerResult } from '../scripts/worker-files.mjs';
import { runOwnedChild } from '../scripts/worker-process.mjs';
it('uses only the fixed real CLI, ephemeral read-only execution and stdin prompt',()=>{
  const spec=codexSpec('/tmp','/tmp/schema.json','/tmp/result.json');
  expect(spec.file).toBe(CODEX_EXECUTABLE);
  expect(spec.args).toEqual(['-a','never','exec','--sandbox','read-only','--ephemeral','--json',
    '--output-schema','/tmp/schema.json','--output-last-message','/tmp/result.json','-C','/tmp','-']);
  const prompt=scopedPrompt({id:'synthetic',scope:'$(synthetic command)'});
  expect(prompt).toContain('untrusted assignment data');expect(prompt).toContain('$(synthetic command)');
});
it('integrates a real fake child and removes only its own temporary schema/result files',async()=>{
  let directory;
  const result=await executeCodex({cwd:'/tmp',assignment:{id:'synthetic'},deadline:Date.now()+2000},{availability:{available:true},
    runChild:async(spec,input)=>{
      const resultPath=spec.args[spec.args.indexOf('--output-last-message')+1];directory=resultPath.slice(0,resultPath.lastIndexOf('/'));
      const code='require("node:fs").writeFileSync(process.argv[1],JSON.stringify({summary:"Synthetic inspected finding.",artifacts:[]}));process.stdout.write("private synthetic log")';
      return runOwnedChild({file:process.execPath,args:['-e',code,resultPath],cwd:spec.cwd},input);
    },
  });
  expect(result).toMatchObject({ok:true,summary:'Synthetic inspected finding.',evidence:{exitCode:0}});
  expect(JSON.stringify(result)).not.toContain('private synthetic log');
  await expect(access(directory)).rejects.toThrow();
});
it.each([['malformed',0],['valid',1]])('blocks %s result with exit %s',async(kind,exitCode)=>{
  const result=await executeCodex({cwd:'/tmp',assignment:{id:'synthetic'},deadline:Date.now()+2000},{availability:{available:true},
    runChild:async spec=>{
      await writeFile(spec.args[spec.args.indexOf('--output-last-message')+1],kind==='valid'?JSON.stringify({summary:'Finding',artifacts:[]}):'{}');
      return {exitCode,reason:'exited',directChildReaped:true};
    },
  });
  expect(result.ok).toBe(false);
});
it('refuses symlink, oversized and extra-field output results',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-result-'));
  try{
    const path=join(root,'result.json'),link=join(root,'link.json');
    await writeFile(path,JSON.stringify({summary:'Finding',artifacts:[],extra:'synthetic'}));
    await expect(readWorkerResult(path)).rejects.toThrow();
    await symlink(path,link);await expect(readWorkerResult(link)).rejects.toThrow();
    await writeFile(path,'x'.repeat(20000));await expect(readWorkerResult(path)).rejects.toThrow();
  }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps the real adapter unavailable without changing model, provider, or user config',async()=>{
  expect(codexAvailability()).toMatchObject({available:false,code:'CODEX_CAPABILITY_BOUNDARY_UNVERIFIED'});
  let launched=false;
  await expect(executeCodex({cwd:'/tmp',assignment:{},deadline:Date.now()+1000},{runChild:async()=>{launched=true;}}))
    .rejects.toMatchObject({code:'CODEX_CAPABILITY_BOUNDARY_UNVERIFIED'});
  expect(launched).toBe(false);
});
