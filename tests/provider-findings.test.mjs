import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function enrichAnalysisFindings('),end=html.indexOf('// ---------------------------------------------------------------------------',start);
const context={};vm.createContext(context);vm.runInContext(html.slice(start,end),context);
const plain=value=>JSON.parse(JSON.stringify(value));

test('tool findings enrich existing issues with exact source locations and survive export',()=>{
  const native={issues:[{title:'Existing security concern',items:[]}],connections:[{source:'a',target:'b'}]};
  const finding={path:'lib/server.ex',message:'Invalid callback',severity:1,range:{start:{line:17,character:4},end:{line:17,character:9}}};
  const result=context.enrichAnalysisFindings(native,[{id:'compiler',name:'ElixirLS',status:'ready',findings:[finding,finding]}]);
  assert.equal(result.issues.length,2);
  assert.equal(result.issues[0],native.issues[0]);
  assert.equal(result.connections,native.connections);
  assert.equal(native.issues.length,1);
  const exported=plain(result);
  assert.equal(exported.issues[1].provider,'compiler');
  assert.equal(exported.issues[1].type,'critical');
  assert.equal(exported.issues[1].items[0].line,18);
  assert.deepEqual(exported.issues[1].sourceLocation,{path:finding.path,range:finding.range});
});

test('refresh clears only its own findings and retains failed assessment status',()=>{
  const native={issues:[{title:'Native finding'}]};
  const first=context.enrichAnalysisFindings(native,[{id:'credo',name:'Credo',status:'ready',findings:[{message:'Naming',path:'lib/server.ex'}]}]);
  const second=context.enrichAnalysisFindings(first,[{id:'compiler',name:'ElixirLS',status:'ready',findings:[{message:'Compile error'}]}]);
  const failed=context.enrichAnalysisFindings(second,[{id:'credo',name:'Credo',status:'unavailable',reason:'Command failed',findings:[]}]);
  assert.deepEqual(plain(failed.issues.map(i=>i.title)),['Native finding','Compile error']);
  assert.equal(failed.assessments.credo.status,'unavailable');
  assert.equal(failed.assessments.credo.reason,'Command failed');
  assert.equal(failed.assessments.compiler.status,'ready');
  const cleared=context.enrichAnalysisFindings(failed,[{id:'compiler',name:'ElixirLS',status:'ready',findings:[]}]);
  assert.equal(cleared.issues.length,1);
  assert.equal(cleared.assessments.compiler.status,'ready');
});
