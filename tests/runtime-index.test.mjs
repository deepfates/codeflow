import test from 'node:test';
import assert from 'node:assert/strict';
import {indexRuntime,runtimeAncestors} from '../src/project/runtime-index.mjs';

test('unavailable observations cannot attach stale processes to source',()=>{
 for(const snapshot of [null,{status:'unavailable',processes:[{id:'stale',sourcePath:'lib/server.ex'}]}]){
  const index=indexRuntime(snapshot,[{path:'lib/server.ex'}]);
  assert.equal(index.processesById.size,0);assert.equal(index.processesBySource.size,0);
  assert.deepEqual(index.applications,[]);assert.deepEqual(index.roots,[]);
 }
});

test('multiple observed processes attach only by existing exact source paths and preserve raw records',()=>{
 const first=Object.freeze({id:'one',sourcePath:'lib/server.ex',module:'Server'});
 const second=Object.freeze({id:'two',sourcePath:'lib/server.ex',parentId:'one'});
 const missing=Object.freeze({id:'missing',sourcePath:'old/server.ex',module:'Server'});
 const unknown=Object.freeze({id:'unknown',module:'Server'});
 const processes=Object.freeze([first,second,missing,unknown]);
 const snapshot=Object.freeze({status:'ready',processes});
 const files=Object.freeze([Object.freeze({path:'lib/server.ex'})]);
 const index=indexRuntime(snapshot,files);
 assert.equal(index.processesById.size,4);
 assert.deepEqual([...index.processesBySource.keys()],['lib/server.ex']);
 assert.equal(index.processesBySource.get('lib/server.ex')[0],first);
 assert.equal(index.processesBySource.get('lib/server.ex')[1],second);
 assert.equal(index.processesById.get('missing'),missing);
 assert.deepEqual(index.roots,[first,missing,unknown]);
});

test('applications with project root source sort first then alphabetically without mutating input',()=>{
 const processes=[{id:'local',sourcePath:'lib/server.ex',application:'zulu'},{id:'external',sourcePath:'outside.ex',application:'alpha'}];
 const external=Object.freeze({name:'alpha',rootId:'external'}),local=Object.freeze({name:'zulu',rootId:'local'}),other=Object.freeze({name:'beta'});
 const applications=Object.freeze([other,external,local]);
 const index=indexRuntime(Object.freeze({status:'ready',processes:Object.freeze(processes),applications}),[{path:'lib/server.ex'}]);
 assert.deepEqual(index.applications,[local,external,other]);
 assert.equal(index.applications[0],local);assert.deepEqual(applications,[other,external,local]);
 assert.deepEqual(index.roots,[]);
});

test('ancestor lookup includes current process, terminates cycles and stops at missing parents',()=>{
 const index=indexRuntime({status:'ready',processes:[{id:'child',parentId:'root'},{id:'root',parentId:'child'},{id:'orphan',parentId:'gone'}]});
 assert.deepEqual([...runtimeAncestors(index,'child')],['child','root']);
 assert.deepEqual([...runtimeAncestors(index,'orphan')],['orphan']);
 assert.deepEqual([...runtimeAncestors(index,'gone')],[]);
});
