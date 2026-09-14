import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigationState,reduceInvestigation} from '../src/investigation/state.mjs';
import {filesForOpenedCodePaths} from '../src/investigation/navigation.mjs';
import {restoreWorkspace} from '../src/investigation/workspace.mjs';
const a='lib/a/a.ex',b='lib/b/b.ex';
const data={files:[{path:a,folder:'lib/a',name:'a.ex'},{path:b,folder:'lib/b',name:'b.ex'}],connections:[]};
const run=(state,action)=>reduceInvestigation(state,action,data);
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}

test('closing a selected card reveals a surviving card across folder scopes',()=>{
    let state=run(createInvestigationState(),{type:'open',path:b});
    state=run(state,{type:'open',path:a});
    state=run(state,{type:'scope',scope:'lib/a'});
    const before=JSON.stringify(state);
    const next=run(freeze(state),{type:'close',path:a});
    assert.equal(JSON.stringify(state),before);
    assert.equal(next.selectedPath,b);
    assert.deepEqual(filesForOpenedCodePaths(next.openedPaths,data,next.scope).map(file=>file.path),[b]);
    assert.equal(next.navigation.entries.at(-1).path,b);
    assert.equal(next.navigation.entries.at(-1).scope,null);
});

test('closing last card stays empty until explicit Code view entry',()=>{
    let state=run(createInvestigationState(),{type:'view',view:'code',enter:true});
    assert.equal(state.selectedPath,a);
    state=run(state,{type:'close',path:a});
    assert.equal(state.selectedPath,null);assert.deepEqual(state.openedPaths,[]);
    state=run(state,{type:'view',view:'code'});
    assert.deepEqual(state.openedPaths,[]);
    state=run(state,{type:'view',view:'code',enter:true});
    assert.deepEqual(state.openedPaths,[a]);
});

test('history restores scope, view, range and cards without recording another visit',()=>{
    const range={start:{line:4,character:2},end:{line:4,character:7}};
    let state=run(createInvestigationState(),{type:'scope',scope:'lib/a'});
    state=run(state,{type:'open',path:a,range});
    state=run(state,{type:'select',path:b,scope:'lib/b',view:'graph',camera:{k:2,x:10,y:20}});
    const prior=run(freeze(state),{type:'history',delta:-1,camera:{k:1,x:40,y:50}});
    assert.equal(prior.selectedPath,a);assert.equal(prior.scope,'lib/a');assert.equal(prior.view,'code');
    assert.deepEqual(prior.range,range);assert.deepEqual(prior.openedPaths,[a]);
    assert.equal(prior.navigation.entries.length,2);assert.equal(prior.navigation.index,0);
    assert.deepEqual(prior.navigation.entries[1].camera,{k:1,x:40,y:50});
    assert.equal(state.navigation.entries[1].camera,null);
    const next=run(prior,{type:'history',delta:1});assert.equal(next.selectedPath,b);assert.equal(next.view,'graph');
});

test('workspace restore preserves current history and range without recording selection',()=>{
    const range={start:{line:10,character:0}};
    const workspace=restoreWorkspace({version:1,selected:b,opened:[a,b],scope:'lib/b',view:'code',navigation:{entries:[{path:a,view:'graph',scope:null},{path:b,view:'code',scope:'lib/b',range}],index:1}},data);
    const result=run(createInvestigationState(),{type:'restore',workspace:freeze(workspace)});
    assert.equal(result.navigation.entries.length,2);assert.equal(result.navigation.index,1);
    assert.equal(result.selectedPath,b);assert.deepEqual(result.range,range);assert.deepEqual(result.openedPaths,[a,b]);
});

test('invalid source selection does not create a card or history and clear removes source range',()=>{
    const state=run(createInvestigationState(),{type:'open',path:a,range:{start:{line:1}}});
    assert.equal(run(state,{type:'open',path:'gone.ex'}),state);
    assert.equal(run(state,{type:'select',path:'gone.ex'}),state);
    const cleared=run(state,{type:'select',path:null});assert.equal(cleared.selectedPath,null);assert.equal(cleared.range,null);
    assert.deepEqual(cleared.openedPaths,[a]);
    assert.deepEqual(run(state,{type:'reset'}),createInvestigationState());
});

test('explicit architecture entry clears selection while passive view restoration does not',()=>{
    const state=run(createInvestigationState(),{type:'open',path:a});
    assert.equal(run(state,{type:'view',view:'architecture'}).selectedPath,a);
    assert.equal(run(state,{type:'view',view:'architecture',enter:true}).selectedPath,null);
    assert.deepEqual(run(state,{type:'view',view:'architecture',enter:true}).openedPaths,[a]);
});
