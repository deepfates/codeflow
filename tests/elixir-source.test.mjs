import assert from 'node:assert/strict';
import test from 'node:test';
import { createNodeAnalyzer } from './helpers/analysis.mjs';
const { Parser, buildAnalysisData } = createNodeAnalyzer();
await Parser.prepareTreeSitter([{path:'lib/example.ex'}]);
assert.ok(Parser.getLoadedTreeSitterParser('lib/example.ex'),'vendored Elixir grammar must load');
const plain=x=>JSON.parse(JSON.stringify(x));
const source=String.raw`defmodule Example do
  use GenServer
  @behaviour Access
  alias Services.{Store, Other}
  alias Services.Worker, as: W
  def fetch(key, options \\ [])
  def fetch(:cached, options), do: Store.get(options)
  def fetch(key, options) when is_binary(key) do
    key |> W.run(options)
    &Store.get/1
    helper(key)
  end
  defp helper(value), do: value
  defdelegate delegated(value), to: Store, as: :get
  defmodule Nested do
    def fetch(), do: :nested
  end
end
`;

test('real Elixir grammar groups clauses with module, arity, defaults and source ranges',()=>{
 const analysis=Parser.analyzeElixir(source,'lib/example.ex');
 assert.equal(analysis.status,'ready');
 assert.deepEqual(plain(analysis.functions.map(fn=>fn.name)),['Example.fetch/2','Example.helper/1','Example.delegated/1','Example.Nested.fetch/0']);
 const fetch=analysis.functions[0];assert.equal(fetch.clauses.length,3);assert.deepEqual(plain(fetch.acceptedArities),[1,2]);
 assert.equal(fetch.line,6);assert.equal(fetch.endLine,12);assert.equal(fetch.range.start.line,5);
 assert.equal(analysis.functions[1].visibility,'private');
 assert.deepEqual(plain(analysis.modules[0].uses),[{module:'GenServer',line:2,arguments:[]}]);
 assert.deepEqual(plain(analysis.modules[0].behaviours),[{module:'Access',line:3}]);
 assert.ok(analysis.calls.some(c=>c.module==='Services.Worker'&&c.function==='run'&&c.arity===2));
 assert.ok(analysis.calls.some(c=>c.module==='Services.Store'&&c.function==='get'&&c.arity===1));
});

async function analyze(sources){
 const files=Object.entries(sources).map(([path,content])=>({path,name:path.split('/').pop(),folder:'lib',content,functions:[],lines:content.split('\n').length,layer:'utils',isCode:true}));
 return buildAnalysisData({analyzed:files,allFns:[],yieldFn:async()=>{}});
}

test('native analysis resolves exact module/arity and keeps dynamic or ambiguous calls unresolved',async()=>{
 const data=await analyze({
  'lib/a.ex':String.raw`defmodule A do
 def same(x), do: x
 def default(x, y \\ 1), do: {x,y}
 defp secret(x), do: x
end`,
  'lib/b.ex':`defmodule B do
 def same(x), do: x
 def same(x,y), do: {x,y}
end`,
  'lib/c.ex':`defmodule C do
 alias A, as: First
 import B, only: [same: 2]
 def run(module) do
   First.same(1)
   First.default(1)
   same(1,2)
   module.same(1)
   Unknown.same(1)
   A.secret(1)
 end
end`,
 });
 const edges=data.connections.filter(c=>c.target==='lib/c.ex');
 assert.deepEqual(plain(edges.map(c=>c.fn).sort()),['A.default/2','A.same/1','B.same/2']);
 assert.ok(edges.every(c=>c.evidence==='tree-sitter:elixir'));
 const unresolved=data.files.find(f=>f.path==='lib/c.ex').elixir.unresolved;
 assert.ok(unresolved.some(c=>c.reason==='Dynamic receiver'));
 assert.ok(unresolved.some(c=>c.module==='Unknown'));
 assert.ok(unresolved.some(c=>c.function==='secret'));
 assert.equal(data.stats.functions,6);
});

test('quoted generated code and parse failures are explicit rather than guessed definitions',()=>{
 const quoted=Parser.analyzeElixir('defmodule Macro do\n defmacro make do\n quote do\n def generated(), do: :ok\n end\n end\nend','macro.ex');
 assert.deepEqual(plain(quoted.functions.map(fn=>fn.name)),['Macro.make/0']);
 assert.ok(quoted.unresolved.some(c=>c.reason.includes('macro expansion')));
 const partial=Parser.analyzeElixir('defmodule Broken do\n def run(', 'broken.ex');
 assert.equal(partial.status,'partial');
});

test('zero-arity calls respect lexical bindings and module boundaries in one file',async()=>{
 const data=await analyze({'lib/modules.ex':`defmodule One do
 def value(), do: 1
 def read(value), do: value
 def run(input) do
   bound = value
   case input do
     {:ok, value} -> value
     _ -> value
   end
   bound
 end
 defmodule Inner.Deep do
  def value(), do: 2
  def run(), do: value
 end
end

defmodule Two do
 def value(), do: 3
 def run(), do: value
end`});
 const stats=Object.values(data.fnStats);
 assert.equal(stats.find(fn=>fn.name==='One.value/0').internal,2);
 assert.equal(stats.find(fn=>fn.name==='One.Inner.Deep.value/0').internal,1);
 assert.equal(stats.find(fn=>fn.name==='Two.value/0').internal,1);
 assert.equal(data.connections.length,0);
});

test('ambiguous imports and wrong arities do not guess a same-named target',async()=>{
 const data=await analyze({
  'a.ex':'defmodule A do\n def same(x), do: x\nend',
  'b.ex':'defmodule B do\n def same(x), do: x\nend',
  'c.ex':'defmodule C do\n import A\n import B\n def run(), do: same(1)\n def wrong(), do: A.same(1,2)\nend',
 });
 assert.equal(data.connections.length,0);
 const unresolved=data.files.find(f=>f.path==='c.ex').elixir.unresolved;
 assert.ok(unresolved.some(c=>c.reason==='Ambiguous import or module definition'));
 assert.ok(unresolved.some(c=>c.module==='A'&&c.arity===2));
});

test('browser analysis worker loads the vendored Elixir grammar in its actual worker environment', {
 skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 45000,
}, async t => {
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {createCodeflowServer}=await import('../cli/codeflow.mjs');
 const {chromium}=await import('playwright');
 const root=await mkdtemp(join(tmpdir(),'codeflow-elixir-worker-'));
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 const server=app.server;
 let browser;
 t.after(async()=>{if(browser)await browser.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const result=await page.evaluate(async()=>{
   const worker=new Worker('/dist/analysis-worker.js',{type:'module'});
   try{return await new Promise((resolve,reject)=>{
     worker.onmessage=event=>{if(event.data.type==='done')resolve(event.data.data);else if(event.data.type==='error')reject(new Error(event.data.message));};
     worker.onerror=event=>reject(new Error(event.message));
     worker.postMessage({analyzed:[{path:'lib/example.ex',name:'example.ex',folder:'lib',content:'defmodule Example do\n def run(), do: :ok\nend',functions:[],isCode:true,lines:3,layer:'utils'}],allFns:[]});
   });}finally{worker.terminate();}
 });
 assert.equal(result.files[0].elixir.status,'ready');
 assert.equal(result.files[0].parserProvenance,'tree-sitter:elixir');
 assert.equal(result.functions[0].name,'Example.run/0');
});

test('successive Node investigations retain the grammar runtime after initialization',async()=>{
 const {createNodeAnalyzer}=await import('../src/node/analysis.mjs');
 for(let i=0;i<3;i++){
  const {buildAnalysisData}=createNodeAnalyzer();
  const data=await buildAnalysisData({analyzed:[{path:'lib/repeated.ex',name:'repeated.ex',folder:'lib',content:'defmodule Repeated do\n def run(), do: :ok\nend',functions:[],isCode:true,lines:3}]});
  assert.equal(data.files[0].elixir.status,'ready','investigation '+i);
  assert.equal(data.files[0].functions[0].name,'Repeated.run/0');
 }
});
