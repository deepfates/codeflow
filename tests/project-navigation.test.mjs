import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('// ===== CODEFLOW_CANVAS_START ====='),end=html.indexOf('// ===== CODEFLOW_CANVAS_END =====');
const context={};vm.createContext(context);vm.runInContext(html.slice(start,end),context);
const plain=v=>JSON.parse(JSON.stringify(v));

test('search resolves file paths, module names and exact function identities',()=>{
 const data={files:[{path:'lib/imp/signature.ex',name:'signature.ex',functions:[{name:'Imp.Signature.new/1',line:42}],elixir:{modules:[{name:'Imp.Signature',line:1}]}},{path:'test/imp/signature_test.exs',name:'signature_test.exs',functions:[]}]};
 const results=plain(context.searchProject(data,'Imp.Signature.new/1'));
 assert.equal(results[0].kind,'symbol');assert.equal(results[0].path,'lib/imp/signature.ex');assert.equal(results[0].line,42);
 assert.ok(context.searchProject(data,'signature').some(r=>r.kind==='module'));
 assert.ok(context.searchProject(data,'signature test').some(r=>r.path==='test/imp/signature_test.exs'));
 assert.equal(context.searchProject(data,'absent').length,0);
});

test('navigation branches from the current position and retains camera context',()=>{
 let history={entries:[],index:-1};
 history=context.recordNavigation(history,{path:'a',view:'graph',scope:null,camera:{k:1,x:2,y:3}});
 history=context.recordNavigation(history,{path:'b',view:'code',scope:null,camera:null});
 history.index=0;
 history=context.recordNavigation(history,{path:'c',view:'code',scope:null,camera:null});
 assert.deepEqual(plain(history.entries.map(e=>e.path)),['a','c']);
 assert.deepEqual(plain(history.entries[0].camera),{k:1,x:2,y:3});
 assert.equal(history.index,1);
});

test('saved investigations retain architecture view and prune missing history locations',()=>{
 const restored=context.restoreWorkspace({version:1,view:'architecture',navigation:{entries:[{path:'a',view:'graph'},{path:'gone',view:'code'},{path:'b',view:'code'}],index:1}}, {files:[{path:'a'},{path:'b'}]});
 assert.equal(restored.view,'architecture');
 assert.deepEqual(plain(restored.navigation.entries.map(e=>e.path)),['a','b']);
 assert.equal(restored.navigation.index,0);
});

test('history transitions preserve previous snapshots and distinct definitions in one file',()=>{
 const original={entries:[{path:'a.ex',scope:null,view:'code',range:{start:{line:3,character:0}},camera:null}],index:0};
 const frozen=JSON.stringify(original);
 const next=context.recordNavigation(original,{path:'a.ex',scope:null,view:'code',range:{start:{line:8,character:0}},camera:null},{k:2,x:20,y:30});
 assert.equal(JSON.stringify(original),frozen,'recording a camera must not mutate a retained snapshot');
 assert.equal(next.entries.length,2,'two definitions in the same file are different locations');
 const prior=context.stepNavigation(next,-1,{k:1,x:4,y:5});
 assert.equal(prior.index,0);assert.equal(prior.entries[0].range.start.line,3);
 assert.equal(next.entries[1].camera,null,'moving back does not mutate forward history');
 assert.deepEqual(plain(prior.entries[1].camera),{k:1,x:4,y:5});
 assert.equal(context.stepNavigation(prior,-1),null);
});


test('workspace retains a selected architecture block only while it exists',()=>{
 const saved={version:1,view:'architecture',architectureBlockId:'namespace_imp'};
 const data={files:[],architectureDiagram:{blocks:[{id:'namespace_imp'}]}};
 assert.equal(context.restoreWorkspace(saved,data).architectureBlockId,'namespace_imp');
 assert.equal(context.restoreWorkspace(saved,{files:[]}).architectureBlockId,null);
});
