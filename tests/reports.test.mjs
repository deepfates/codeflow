import test from 'node:test';
import assert from 'node:assert/strict';
import {generateAnalysisReport,buildAnalysisReport} from '../src/project/reports.mjs';
import {functionKey} from '../src/project/identity.mjs';

const context={repository:'owner/project',analyzedAt:'2026-09-14T00:00:00.000Z'};
function analysis(){
 const files=Array.from({length:125},(_,i)=>({path:`lib/feature_${i}/same.ex`,name:'same.ex',folder:`lib/feature_${i}`,lines:20,layer:'utils',functions:[]}));
 const patternFiles=Array.from({length:12},(_,i)=>({path:`patterns/feature_${i}/same.ex`,name:'same.ex'}));
 const items=Array.from({length:12},(_,i)=>({path:`issues/feature_${i}/same.ex`,name:'problem',line:i+1}));
 const deadFunctions=Array.from({length:65},(_,i)=>({name:`Fixture.unobserved_${i}/0`,file:files[i].path,line:i+1,codeLines:1,certainty:'unverified',evidence:'source analysis'}));
 const connections=Array.from({length:130},(_,i)=>({source:{id:`lib/provider_${i}/same.ex`},target:{id:`lib/consumer_${i}/same.ex`},fn:null,count:1,kind:['compile','export','runtime'][i%3],evidence:'mix xref',producer:{name:'Mix'}}));
 connections.push({source:'lib/source.js',target:'lib/consumer.js',fn:'run',count:3,evidence:'source analysis'});
 connections.push({source:'README.md',target:'docs/design.md',fn:'design',count:1,kind:'markdown-link'});
 return {files,deadFunctions,connections,fnStats:{},issues:[{title:'Affected modules',desc:'Evidence from analysis',type:'warning',items}],patterns:[{name:'A pattern',desc:'Pattern evidence',files:patternFiles},{name:'An anti-pattern',desc:'Anti-pattern evidence',isAnti:true,files:patternFiles.map(file=>({...file,path:file.path.replace('patterns/','anti-patterns/')}))}],securityIssues:[],folders:[],stats:{files:125,functions:65,connections:132,dead:65,loc:2500}};
}

test('Markdown and text reports retain every eligible record beyond former section caps and full source paths',()=>{
 const data=analysis();
 for(const format of ['md','txt']){
  const report=generateAnalysisReport({...context,data,format});
  assert.equal(report.filename,'codeflow-report.'+format);
  assert.ok(report.content.includes(context.repository));
  assert.ok(report.content.includes(context.analyzedAt));
  for(const file of data.files)assert.ok(report.content.includes(file.path),'file omitted: '+file.path);
  for(const fn of data.deadFunctions)assert.ok(report.content.includes(fn.name),'function omitted: '+fn.name);
  for(const file of data.patterns.flatMap(pattern=>pattern.files))assert.ok(report.content.includes(file.path),'pattern member omitted: '+file.path);
  for(const item of data.issues[0].items)assert.ok(report.content.includes(item.path+':'+item.line),'affected location omitted: '+item.path);
  for(const edge of data.connections.slice(0,130))assert.ok(report.content.includes(edge.source.id+' -> '+edge.target.id),'dependency omitted: '+edge.source.id);
  assert.match(report.content,/compile; mix xref; 1 reference/);
  assert.match(report.content,/runtime; mix xref; 1 reference/);
  assert.match(report.content,/markdown-link; source analysis; 1 reference; design/);
  assert.doesNotMatch(report.content,/null: 1 calls|more unused functions|more dependencies|more files/);
 }
});

test('JSON report preserves relationship evidence and distinguishes compiler references from function call counts',()=>{
 const data=analysis();
 const json=JSON.parse(generateAnalysisReport({...context,data,format:'json'}).content);
 assert.equal(json.files.length,125);
 assert.equal(json.dependencies.length,132);
 assert.equal(json.unusedFunctions.length,65);
 assert.equal(json.architectureIssues[0].affectedItems.length,12);
 assert.equal(json.patterns[0].fileDetails.length,12);
 assert.equal(json.dependencies[0].from,'lib/provider_0/same.ex');
 assert.equal(json.dependencies[0].callCount,null);
 assert.equal(json.dependencies[0].referenceCount,1);
 assert.equal(json.dependencies[0].kind,'compile');
 assert.deepEqual(json.dependencies[0].producer,{name:'Mix'});
 assert.equal(json.dependencies[130].callCount,3);
 assert.equal(json.dependencies[131].callCount,null,'a documentation link is not a function call');
});

test('reports use shared function identities and explicit dates without mutating analysis',()=>{
 const data=analysis();
 const fn={file:data.files[0].path,line:7,name:'Fixture.same/0'};
 data.files[0].functions=[fn];
 data.fnStats[functionKey(fn)]={...fn,internal:2,external:4,usageCertainty:'unverified'};
 const before=JSON.stringify(data);
 const first=buildAnalysisReport({...context,data});
 assert.equal(first.files[0].functions[0].key,'lib/feature_0/same.ex|7|Fixture.same/0');
 assert.equal(first.files[0].functions[0].totalCalls,6);
 assert.equal(first.files[0].functions[0].isUnused,null);
 assert.deepEqual(buildAnalysisReport({...context,data}),first);
 assert.equal(JSON.stringify(data),before);
 assert.throws(()=>generateAnalysisReport({...context,data,format:'csv'}),/Unsupported report format/);
});
