import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeAnalyzer} from '../src/node/analysis.mjs';

test('raw acquisition records become a complete mixed-language project without transport-built symbols',async()=>{
 const {analyzeFiles}=createNodeAnalyzer();
 const files=[
  {path:'lib/one.ex',content:'defmodule One do\n def value(), do: 42\nend'},
  {path:'lib/two.ex',content:'defmodule Two do\n def run(), do: One.value()\nend'},
  {path:'src/widget.tsx',content:'export function Widget({name}: {name: string}) { return <div>{name}</div>; }'},
  {path:'src/example.py',content:'class Example:\n    def answer(self):\n        return 42\n'},
  {path:'empty.txt',content:''},
  {path:'unread.js',analysisSkipped:'fetch-failed'},
 ];
 const before=JSON.stringify(files);
 const data=await analyzeFiles({files});
 assert.equal(JSON.stringify(files),before,'collection records remain unchanged');
 assert.equal(data.files.length,6);
 assert.equal(data.files.find(f=>f.path==='lib/one.ex').elixir.status,'ready');
 assert.ok(data.connections.some(edge=>edge.source==='lib/one.ex'&&edge.target==='lib/two.ex'));
 assert.ok(data.files.find(f=>f.path==='src/widget.tsx').functions.some(fn=>fn.name==='Widget'));
 const python=data.files.find(f=>f.path==='src/example.py');
 assert.equal(python.parserProvenance,'tree-sitter:python-calls');
 assert.ok(python.functions.some(fn=>fn.name==='Example.answer'));
 assert.equal(data.files.find(f=>f.path==='empty.txt').lines,0);
 assert.equal(data.files.find(f=>f.path==='unread.js').analysisSkipped,'fetch-failed');
 assert.ok(data.functions.every(fn=>fn.file&&fn.line),'engine owns function identity and source coordinates');
});

test('a stale transport classification cannot suppress executable HTML source',async()=>{
 const {analyzeFiles}=createNodeAnalyzer();
 const data=await analyzeFiles({files:[{path:'index.html',isCode:false,content:'<script>function launch(input) { return eval(input); }</script>'}]});
 assert.equal(data.files[0].isCode,true);
 assert.ok(data.functions.some(fn=>fn.name==='launch'));
 assert.ok(data.securityIssues.some(issue=>issue.title==='Dynamic Code Execution'));
});
