import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {collectCredo} from '../cli/elixir-analysis.mjs';
const execute=promisify(execFile);
const realMix={skip:!process.env.CODEFLOW_TEST_MIX,timeout:180000};
async function project(t,deps='[]'){
  const root=await mkdtemp(join(tmpdir(),'codeflow-credo-integration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'lib'));
  await writeFile(join(root,'mix.exs'),`defmodule Fixture.MixProject do\n use Mix.Project\n def project, do: [app: :fixture, version: "0.1.0", deps: ${deps}]\nend\n`);
  await writeFile(join(root,'lib/fixture.ex'),'defmodule Fixture do\n  def number(), do: 123456\nend\n');
  return root;
}

test('Codeflow-provided Credo finds real issues without adding a dependency to the project',realMix,async t=>{
  const root=await project(t);
  const original=await readFile(join(root,'mix.exs'),'utf8');
  const before=(await readdir(root)).sort();
  const result=await collectCredo(root);
  assert.equal(result.status,'ready',result.reason);
  const finding=result.findings.find(issue=>issue.check==='Credo.Check.Readability.LargeNumbers');
  assert.ok(finding,'real Credo must report the intentionally unformatted number');
  assert.equal(finding.path,'lib/fixture.ex');
  assert.equal(finding.range.start.line,1);
  assert.equal(await readFile(join(root,'mix.exs'),'utf8'),original);
  assert.deepEqual((await readdir(root)).sort(),before,'standalone tooling cannot install into the consumer project');
});

test('project-provided Credo keeps its version, configuration, custom checks and plugins',realMix,async t=>{
  const root=await project(t,'[{:credo, "== 1.7.18", runtime: false}, {:fixture_plugin, path: "plugins/fixture_plugin", runtime: false}]');
  await mkdir(join(root,'checks'));
  await mkdir(join(root,'plugins/fixture_plugin/lib'),{recursive:true});
  await writeFile(join(root,'plugins/fixture_plugin/mix.exs'),'defmodule FixturePlugin.MixProject do\n use Mix.Project\n def project, do: [app: :fixture_plugin, version: "0.1.0"]\nend\n');
  await writeFile(join(root,'checks/custom.exs'),`defmodule Fixture.Check do
  use Credo.Check, base_priority: :high, category: :warning, explanations: [check: "Version probe"]
  def run(source_file, params) do
    [format_issue(Credo.IssueMeta.for(source_file, params), message: "project Credo " <> Credo.version(), line_no: 2, column: 3)]
  end
end
`);
  await writeFile(join(root,'plugins/fixture_plugin/lib/plugin.ex'),`defmodule Fixture.Plugin do
  def init(exec) do
    File.write!("plugin-ran", Credo.version())
    exec
  end
end
`);
  await writeFile(join(root,'.credo.exs'),`%{configs: [%{name: "default", files: %{included: ["lib/"], excluded: []}, requires: ["checks/custom.exs"], plugins: [{Fixture.Plugin, []}], checks: %{enabled: [{Fixture.Check, []}]}}]}\n`);
  await execute('mix',['deps.get'],{cwd:root,timeout:120000,maxBuffer:4*1024*1024});
  const lock=await readFile(join(root,'mix.lock'),'utf8');
  const result=await collectCredo(root);
  assert.equal(result.status,'ready',result.reason);
  assert.equal(result.findings.length,1,'project config disables default checks and enables its own check');
  assert.equal(result.findings[0].message,'project Credo 1.7.18','the project version takes precedence over Codeflow 1.7.19');
  assert.equal(result.findings[0].path,'lib/fixture.ex');
  assert.equal(result.findings[0].range.start.line,1);
  assert.equal(await readFile(join(root,'plugin-ran'),'utf8'),'1.7.18');
  assert.equal(await readFile(join(root,'mix.lock'),'utf8'),lock);
});

test('a declared but unavailable project Credo remains a failure rather than switching tools',realMix,async t=>{
  const root=await project(t,'[{:credo, "== 0.0.0"}]');
  const result=await collectCredo(root);
  assert.equal(result.status,'unavailable');
  assert.deepEqual(result.findings,[]);
  assert.ok(result.reason);
  await assert.rejects(access(join(root,'mix.lock')),{code:'ENOENT'});
});


test('ordinary CLI runs Credo even when ElixirLS cannot start',realMix,async t=>{
  const root=await project(t);
  const cli=spawn(process.execPath,[fileURLToPath(new URL('../cli/codeflow.mjs',import.meta.url)),root,'--port','0','--no-open'],{
    env:{...process.env,CODEFLOW_ELIXIR_LS:join(root,'missing-language-server')},stdio:['ignore','pipe','pipe'],
  });
  const exited=new Promise(resolve=>cli.once('exit',resolve));
  t.after(async()=>{if(cli.exitCode===null)cli.kill('SIGTERM');await exited;});
  let output='';
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('CLI startup timed out: '+output)),30000);
    cli.stdout.on('data',chunk=>{
      output+=chunk;
      const match=output.match(/Codeflow UI: (http:\/\/[^\s]+)/);
      if(match){clearTimeout(timer);resolve(match[1]);}
    });
    cli.stderr.on('data',chunk=>{output+=chunk;});
    cli.once('error',error=>{clearTimeout(timer);reject(error);});
    cli.once('exit',code=>{clearTimeout(timer);reject(new Error('CLI exited '+code+': '+output));});
  });
  let status;
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
    status=await (await fetch(new URL('/__codeflow/analysis',url)).catch(error=>{throw new Error('CLI analysis request failed (exit '+cli.exitCode+'): '+output,{cause:error});})).json();
    if(status.language.state==='error'&&status.assessment.status!=='pending')break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(status.language.state,'error','the deliberately missing language server must actually fail');
  assert.equal(status.assessment.status,'ready',JSON.stringify(status));
  assert.ok(status.assessment.findings.some(issue=>issue.check==='Credo.Check.Readability.LargeNumbers'));
});
