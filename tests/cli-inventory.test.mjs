import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listWatchFiles} from '../cli/codeflow.mjs';
import {collectFiles} from '../card/lib/collect.js';
import {createParser} from '../src/analysis/parser.mjs';

test('CLI and headless collection retain the same source, data and documentation inventory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-inventory-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const included=['.github/workflows/ci.yml','.gitignore','.gitattributes','.env.example','data/samples.csv','data/events.jsonl','mix.lock','notes.txt','LICENSE','lib/main.ex'];
 const excluded=['.git/config','deps/pkg/lib/main.ex','apps/web/deps/pkg/main.ex','_build/dev/main.ex','.elixir_ls/build/main.ex','image.png','artifact.wasm'];
 for(const file of [...included,...excluded]){
  await mkdir(join(root,file,'..'),{recursive:true});
  await writeFile(join(root,file),'sample');
 }
 const cli=(await listWatchFiles(root)).map(f=>f.path).sort();
 const headless=(await collectFiles(root,createParser(),[])).map(f=>f.path).sort();
 assert.deepEqual(cli,included.sort());
 assert.deepEqual(cli,headless);
});
