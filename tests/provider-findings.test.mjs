import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichAnalysisFindings } from '../src/analysis/evidence.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));

test('tool findings enrich existing issues with exact source locations and survive export',()=>{
  const native={issues:[{title:'Existing security concern',items:[]}],connections:[{source:'a',target:'b'}]};
  const finding={path:'lib/server.ex',message:'Invalid callback',severity:1,range:{start:{line:17,character:4},end:{line:17,character:9}}};
  const result=enrichAnalysisFindings(native,[{id:'compiler',name:'ElixirLS',status:'ready',findings:[finding,finding]}]);
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
  const first=enrichAnalysisFindings(native,[{id:'credo',name:'Credo',status:'ready',findings:[{message:'Naming',path:'lib/server.ex'}]}]);
  const second=enrichAnalysisFindings(first,[{id:'compiler',name:'ElixirLS',status:'ready',findings:[{message:'Compile error'}]}]);
  const failed=enrichAnalysisFindings(second,[{id:'credo',name:'Credo',status:'unavailable',reason:'Command failed',findings:[]}]);
  assert.deepEqual(plain(failed.issues.map(i=>i.title)),['Native finding','Compile error']);
  assert.equal(failed.assessments.credo.status,'unavailable');
  assert.equal(failed.assessments.credo.reason,'Command failed');
  assert.equal(failed.assessments.compiler.status,'ready');
  const cleared=enrichAnalysisFindings(failed,[{id:'compiler',name:'ElixirLS',status:'ready',findings:[]}]);
  assert.equal(cleared.issues.length,1);
  assert.equal(cleared.assessments.compiler.status,'ready');
});

test('informational language diagnostics keep their severity in the shared file assessment',async()=>{
  const {indexSourceFindings}=await import('../src/project/source-findings.mjs');
  const native={files:[{path:'lib/info.ex'},{path:'lib/hint.ex'}],issues:[]};
  const findings=[{path:'lib/info.ex',message:'Information',severity:3},{path:'lib/hint.ex',message:'Hint',severity:4}];
  const result=enrichAnalysisFindings(native,[{id:'compiler',name:'ElixirLS',status:'ready',findings}]);
  assert.deepEqual(result.issues.map(issue=>issue.type),['info','info']);
  assert.deepEqual([...indexSourceFindings(result).values()].map(file=>file.maxSeverity),['info','info']);
  assert.deepEqual(plain(result).issues.map(issue=>issue.finding.severity),[3,4],'original diagnostic severities remain available in exports');
});
