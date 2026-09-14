const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');

test('offline browser artifacts match the canonical source modules and parse',()=>{
 const root=path.join(__dirname,'..');
 execFileSync(process.execPath,['scripts/build.mjs','--check'],{cwd:root});
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/<script src="\.\/dist\/app\.js"><\/script>/);
 for(const file of ['app.js','analysis-worker.js','node-babel.cjs']){
  assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(root,'dist',file),'utf8'),{filename:file}));
 }
});
