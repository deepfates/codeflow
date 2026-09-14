import assert from 'node:assert/strict';
import test from 'node:test';
import { createNodeAnalyzer } from './helpers/analysis.mjs';
import { buildBeamAnalysisData } from '../src/analysis/evidence.mjs';
import * as architecture from '../src/analysis/architecture.mjs';
const { Parser, buildAnalysisData } = createNodeAnalyzer();
await Parser.prepareTreeSitter([{path:'lib/example.ex'}]);
assert.ok(Parser.getLoadedTreeSitterParser('lib/example.ex'),'vendored Elixir grammar must load');
function source(path,content){
  const elixir=Parser.analyzeElixir(content,path);
  return {path,name:path.split('/').pop(),folder:path.split('/').slice(0,-1).join('/')||'root',isCode:true,content,functions:elixir.functions,elixir,lines:content.split('\n').length};
}

test('declared Elixir namespaces and OTP roles enrich native blocks without dropping member files',()=>{
  const files=[
    source('lib/application.ex','defmodule Example.Application do\n use Application\n def start(_, _), do: Example.Supervisor.start_link([])\nend'),
    source('lib/supervisor.ex','defmodule Example.Supervisor do\n use Supervisor\n def start_link(x), do: Supervisor.start_link(__MODULE__,x)\nend'),
    source('lib/session.ex','defmodule Example.Session do\n use GenServer\n def init(x), do: {:ok,x}\nend'),
    source('lib/client.ex','defmodule Example.Client do\n def run, do: Example.Workers.N79.run()\nend'),
    ...Array.from({length:80},(_,i)=>source('lib/unrelated_name_'+i+'.ex',`defmodule Example.Workers.N${i} do\n def run, do: :ok\nend`)),
    source('test/session_test.exs','defmodule Example.SessionTest do\n use ExUnit.Case\nend'),
  ];
  const diagram=architecture.buildArchitectureDiagram(files);
  const workers=diagram.blocks.find(b=>b.title==='Example.Workers');
  assert.equal(workers.files.length,80,'namespace aggregation occurs before any raw-file cap');
  assert.equal(workers.modules.length,80);
  assert.ok(workers.declarations.some(d=>d.module==='Example.Workers.N79'&&d.line===1&&d.evidence==='tree-sitter:elixir'));
  assert.equal(diagram.blocks.find(b=>b.title==='Example.Application').role,'otp-application');
  assert.equal(diagram.blocks.find(b=>b.title==='Example.Supervisor').role,'otp-supervisor');
  assert.equal(diagram.blocks.find(b=>b.title==='Example.Session').role,'otp-process');
  assert.equal(new Set(diagram.blocks.flatMap(b=>b.files)).size,files.length,'all source and test membership survives');
  const caller=diagram.blocks.find(b=>b.title==='Example.Client');
  assert.ok(diagram.dependencies.some(d=>d.from===caller.id&&d.to===workers.id&&d.kind==='source-reference'));
  assert.match(diagram.mermaid,/Example.Workers/);
  assert.match(diagram.mermaid,/Example.Session/,'groups outside the initial profile order still render');
  assert.doesNotMatch(diagram.mermaid,/Example.SessionTest/);
  assert.match(architecture.generateMermaidBlockDiagram(diagram,true,false),/Example.SessionTest/);
  const data={files,connections:[],functions:[],fnStats:{},issues:[],suggestions:[],deadFunctions:[],stats:{},architectureDiagram:diagram};
  const enriched=buildBeamAnalysisData({data:data,snapshot:{status:'ready',nodes:[],edges:[{source:'lib/client.ex',target:'lib/unrelated_name_79.ex',kind:'compile'}]}});
  assert.ok(enriched.architectureDiagram.dependencies.some(d=>d.from===caller.id&&d.to===workers.id&&d.kind==='compile'&&d.evidence==='mix xref'));
});

test('Phoenix macro conventions require a declared Phoenix wrapper and retain their use evidence',()=>{
  const files=[
    source('lib/web.ex','defmodule ExampleWeb do\n def live_view do\n quote do\n use Phoenix.LiveView\n end\n end\nend'),
    source('lib/page.ex','defmodule ExampleWeb.PageLive do\n use ExampleWeb, :live_view\nend'),
    source('lib/router.ex','defmodule ExampleWeb.Router do\n use Phoenix.Router\nend'),
    source('lib/unrelated.ex','defmodule Unrelated do\n use UnknownWeb, :live_view\nend'),
  ];
  const diagram=architecture.buildArchitectureDiagram(files);
  const page=diagram.blocks.find(b=>b.title==='ExampleWeb.PageLive');
  assert.equal(page.role,'phoenix-live-view');
  assert.ok(page.declarations.some(d=>d.module==='ExampleWeb'&&d.arguments[0]===':live_view'&&d.line===2));
  assert.equal(diagram.blocks.find(b=>b.title==='ExampleWeb.Router').role,'phoenix-endpoint');
  assert.equal(diagram.blocks.find(b=>b.title==='Unrelated').role,'module','an arbitrary macro with the same argument is not Phoenix evidence');
  assert.match(diagram.mermaid,/ExampleWeb.PageLive/);
});

test('Mix takes precedence over generated HTML and examples remain represented in the ordinary overview',()=>{
  const files=[
    source('mix.exs','defmodule Example.MixProject do\n use Mix.Project\nend'),
    source('lib/main.ex','defmodule Example do\n def run, do: :ok\nend'),
    source('examples/demo.exs','defmodule Demo do\n def run, do: Example.run()\nend'),
    source('benchmarks/speed.exs','defmodule Speed do\n def run, do: Example.run()\nend'),
    {path:'doc/index.html',name:'index.html',content:'<main>Generated documentation</main>',isCode:true,functions:[]},
  ];
  const diagram=architecture.buildArchitectureDiagram(files);
  assert.equal(diagram.framework,'Elixir / OTP');
  for(const title of ['Examples','Benchmarks']){
    const block=diagram.blocks.find(b=>b.title===title);
    assert.ok(block&&block.files.length===1);
    assert.ok(architecture.getVisibleArchitectureBlocks(diagram.blocks,false,false).includes(block),'examples stay available without toggling tests');
    assert.match(diagram.mermaid,new RegExp(title));
  }
});

test('native Mermaid export retains every source relationship beyond the former 48-edge limit',()=>{
  const targets=Array.from({length:60},(_,i)=>source('lib/target_'+i+'.ex',`defmodule Target${i} do\n def run, do: :ok\nend`));
  const caller=source('lib/caller.ex','defmodule Caller do\n def run do\n'+targets.map((_,i)=>` Target${i}.run()`).join('\n')+'\n end\nend');
  const diagram=architecture.buildArchitectureDiagram([caller,...targets]);
  assert.equal(diagram.dependencies.length,60,'every resolved source reference reaches the diagram model');
  const from=diagram.blocks.find(b=>b.title==='Caller').id;
  for(let i=0;i<60;i++){
    const to=diagram.blocks.find(b=>b.title==='Target'+i).id;
    assert.ok(diagram.mermaid.includes(from+' -->|"references (source-reference)"| '+to),'Target'+i+' remains reachable in the rendered/exported diagram');
  }
});

test('ambiguous module declarations do not invent a source dependency target',()=>{
  const files=[
    source('lib/one.ex','defmodule Duplicate do\n def run, do: :one\nend'),
    source('lib/two.ex','defmodule Duplicate do\n def run, do: :two\nend'),
    source('lib/caller.ex','defmodule Caller do\n def run, do: Duplicate.run()\nend'),
  ];
  const diagram=architecture.buildArchitectureDiagram(files);
  assert.equal(new Set(diagram.blocks.flatMap(b=>b.files)).size,3);
  assert.equal(diagram.dependencies.filter(d=>d.kind==='source-reference').length,0,'a compiler snapshot can disambiguate; source names alone cannot');
});
