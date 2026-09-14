import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeAnalyzer} from '../src/node/analysis.mjs';

test('independent analyzers can load different grammars on their shared runtime',async()=>{
 const elixir=createNodeAnalyzer(),python=createNodeAnalyzer();
 const [left,right]=await Promise.all([
  elixir.analyzeFiles({files:[{path:'lib/sample.ex',content:'defmodule Sample do\n def value(), do: 42\nend'}]}),
  python.analyzeFiles({files:[{path:'sample.py',content:'class Sample:\n    def value(self):\n        return 42\n'}]}),
 ]);
 assert.equal(left.files[0].elixir.status,'ready');
 assert.ok(left.files[0].functions.some(fn=>fn.name==='Sample.value/0'));
 assert.equal(right.files[0].parserProvenance,'tree-sitter:python-calls');
 assert.ok(right.files[0].functions.some(fn=>fn.name==='Sample.value'));
});
