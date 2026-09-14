import test from 'node:test';
import assert from 'node:assert/strict';
import {indexSourceFindings} from '../src/project/source-findings.mjs';
import {enrichAnalysisFindings} from '../src/analysis/evidence.mjs';

const files=[{path:'lib/server.ex'},{path:'test/server.ex'},{path:'lib/clean.ex'}];

test('provider findings attach by exact current path with original records and ranges',()=>{
 const range={start:{line:5,character:2},end:{line:5,character:8}};
 const finding={path:'lib/server.ex',range,message:'Avoid nesting',severity:2,check:'Credo.Check.Refactor.Nesting'};
 const data=enrichAnalysisFindings({files,issues:[]},[{id:'credo',name:'Credo',status:'ready',findings:[finding,{...finding,path:'old/server.ex'},{...finding,path:'server.ex'}]}]);
 const before=JSON.stringify(data);
 const index=indexSourceFindings(data),source=index.get('lib/server.ex');
 assert.equal(source.count,1,'provider items do not double count their source location');
 assert.equal(source.entries[0].issue,data.issues[0]);
 assert.equal(source.entries[0].issue.finding,finding);
 assert.equal(source.entries[0].sourceLocation,data.issues[0].sourceLocation);
 assert.equal(source.entries[0].sourceLocation.range,range);
 assert.equal(source.maxSeverity,'warning');
 assert.equal(index.get('test/server.ex').count,0,'same basename is not evidence');
 assert.deepEqual(index.get('lib/clean.ex'),{entries:[],count:0,maxSeverity:null});
 assert.equal(index.size,3,'missing source does not create phantom graph files');
 assert.equal(JSON.stringify(data),before);
});

test('native grouped findings retain multiple locations without counting repeated file references',()=>{
 const item={name:'duplicate',files:[{file:'lib/server.ex',line:3},{file:'lib/server.ex',line:3},{file:'lib/server.ex',line:12},{file:'test/server.ex',line:7}]};
 const cycle={name:'cycle',files:['lib/server.ex','lib/server.ex','test/server.ex']};
 const violation={file:'lib/server.ex',toFile:'test/server.ex'};
 const issues=[{type:'warning',items:[item]},{type:'critical',items:[cycle]},{type:'critical',items:[violation]}];
 const index=indexSourceFindings({files,issues});
 const source=index.get('lib/server.ex');
 assert.equal(source.count,4);
 assert.deepEqual(source.entries.map(entry=>entry.sourceLocation.line),[3,12,null,null]);
 assert.equal(source.entries[0].item,item);
 assert.equal(source.entries[1].item,item);
 assert.equal(source.entries[0].issue,issues[0]);
 assert.equal(source.maxSeverity,'critical');
 assert.equal(index.get('test/server.ex').count,3,'both actual endpoints retain the relationship finding');
});

test('security and architecture severities retain their vocabulary and share source totals',()=>{
 const security={path:'lib/server.ex',file:'server.ex',line:19,severity:'high',title:'Hardcoded Secret',code:'secret = value'};
 const index=indexSourceFindings({files,issues:[{type:'warning',items:[{file:'lib/server.ex',line:2}]}],securityIssues:[security,{file:'server.ex',severity:'high'},{path:'test/server.ex',severity:'low'}]});
 const source=index.get('lib/server.ex');
 assert.equal(source.count,2);
 assert.equal(source.maxSeverity,'high');
 assert.equal(source.entries[1].issue,security);
 assert.equal(source.entries[1].kind,'security');
 assert.deepEqual(source.entries[1].sourceLocation,{path:'lib/server.ex',line:19});
 assert.equal(index.get('test/server.ex').maxSeverity,'low');
 assert.equal(index.get('test/server.ex').count,1,'security basename never binds a source');
 assert.equal(indexSourceFindings(null).size,0);
});
