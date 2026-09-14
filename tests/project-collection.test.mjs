import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDirectory,collectSelectedFiles,collectArchive,readCollectedFiles} from '../src/project/collection.mjs';
import {maxAnalyzableFileBytes} from '../src/project/size-policy.mjs';
import {compileExcludePatterns} from '../src/project/exclusions.mjs';

const text='defmodule Example do\nend';
function file(name,content=text){return {name,size:content.length,text:async()=>content};}
function directory(name,entries){return {name,kind:'directory',async *values(){yield*entries;}};}
function handle(name,source=file(name)){return {name,kind:'file',getFile:async()=>source};}

test('directory, selected files and archive share nested exclusions and retain docs/tests',async()=>{
 const paths=['lib/main.ex','test/main_test.exs','docs/design.md','apps/web/lib/main.ex','apps/web/deps/pkg/main.ex','_build/main.ex','lib/omit.ex'];
 const patterns=compileExcludePatterns('lib/omit.ex');
 const selected=await collectSelectedFiles(paths.map(path=>({...file(path.split('/').pop()),webkitRelativePath:'project/'+path})),{patterns});
 const zip={files:Object.fromEntries(paths.map(path=>['project/'+path,{name:'project/'+path,async:async()=>text}]))};
 const archive=await collectArchive(zip,{patterns});
 const root=directory('project',[
  directory('lib',[handle('main.ex'),handle('omit.ex')]),directory('test',[handle('main_test.exs')]),directory('docs',[handle('design.md')]),
  directory('apps',[directory('web',[directory('lib',[handle('main.ex')]),directory('deps',[directory('pkg',[handle('main.ex')])])])]),
  directory('_build',[handle('main.ex')])]);
 const folder=await collectDirectory(root,{patterns});
 const expected=paths.slice(0,4).sort();
 for(const collection of [selected,archive,folder]){
  assert.deepEqual(collection.files.map(f=>f.path).sort(),expected);
  assert.ok((await readCollectedFiles(collection.files)).every(f=>f.content===text));
 }
 assert.equal(selected.rootPrefix,'project/');assert.equal(archive.rootPrefix,'project/');assert.equal(folder.rootPrefix,'');
 assert.deepEqual(Object.keys(archive.entriesByPath).sort(),expected);
});

test('size limits skip text reads, including directory sizes learned at getFile time',async()=>{
 let reads=0;
 const huge={name:'huge.ex',size:maxAnalyzableFileBytes+1,text:async()=>{reads++;throw Error('must not read');}};
 for(const collection of [await collectSelectedFiles([huge]),await collectDirectory(directory('root',[handle('huge.ex',huge)]))]){
  const [record]=await readCollectedFiles(collection.files);
  assert.equal(record.analysisSkipped,'oversized');assert.equal(record.size,huge.size);
 }
 assert.equal(reads,0);
});

test('failed reads retain inventory, while empty text and provider metadata survive',async()=>{
 const descriptors=[
  {path:'failed.ex',name:'failed.ex',read:async()=>{throw Error('permission denied');}},
  {path:'empty.ex',name:'empty.ex',read:async()=>''},
  {path:'main.ex',name:'main.ex',read:async()=>({content:text,size:100,churn:4})},
  {path:'null.ex',name:'null.ex',read:async()=>null}
 ];
 const records=await readCollectedFiles(descriptors);
 assert.equal(records[0].analysisSkipped,'fetch-failed');assert.equal(records[1].content,'');
 assert.equal(records[2].churn,4);assert.equal(records[2].size,100);assert.equal(records[2].content,text);
 assert.equal(records[3].analysisSkipped,'fetch-failed');
});

test('directory enumeration failures reach the caller',async()=>{
 await assert.rejects(collectDirectory({async *values(){throw Error('permission denied');}}),/permission denied/);
});

test('cancellation during a pending read rejects the entire collection, not a failed-file record',async()=>{
 const controller=new AbortController();let finish;
 const pending=readCollectedFiles([{path:'one.ex',name:'one.ex',read:()=>new Promise(resolve=>{finish=resolve;})}],{signal:controller.signal});
 controller.abort();finish(text);
 await assert.rejects(pending,{name:'AbortError'});
 await assert.rejects(collectSelectedFiles([file('one.ex')],{signal:controller.signal}),{name:'AbortError'});
});

test('cancelled directory traversal does not return partial inventory',async()=>{
 const controller=new AbortController();
 const root={async *values(){yield handle('one.ex');controller.abort();yield handle('two.ex');}};
 await assert.rejects(collectDirectory(root,{signal:controller.signal}),{name:'AbortError'});
});
