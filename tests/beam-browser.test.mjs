import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

async function openProject(t,root,options={}) {
  const { chromium } = await import('playwright');
  const server = spawn(process.execPath, [fileURLToPath(new URL('../cli/codeflow.mjs', import.meta.url)), root, '--port', '0', '--no-open', ...(options.args||[])], {env:{...process.env,...options.env},stdio:['ignore','pipe','pipe']});
  const exited = new Promise(resolve => server.once('exit', resolve));
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (server.exitCode === null) server.kill('SIGTERM');
    await exited;
    await rm(root, {recursive:true, force:true});
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('CLI startup timed out: '+output)), 45000);
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Codeflow UI: (http:\/\/[^\s]+)/);
      if (match) {clearTimeout(timer);resolve(match[1]);}
    });
    server.stderr.on('data', chunk => {output += chunk;});
    server.once('exit', code => {clearTimeout(timer);reject(new Error('CLI exited '+code+': '+output));});
  });
  browser = await chromium.launch({headless:true, ...(process.env.CODEFLOW_BROWSER_CHANNEL ? {channel:process.env.CODEFLOW_BROWSER_CHANNEL} : {})});
  const page = await browser.newPage({viewport:{width:1500,height:1000}});
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  return { page, url, errors };
}

// Opt in: this runs the ordinary CLI, real ElixirLS and a real browser.
test('BEAM browser journey: file graph, fresh compilation, source navigation and workspace restoration', {
  skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 180000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-browser-'));
  await mkdir(join(root, 'lib'));
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'README.md'), '# Browser fixture\n');
  await writeFile(join(root, 'test/target_test.exs'), 'ExUnit.start()\n');
  await writeFile(join(root, 'mix.exs'), 'defmodule Browser.MixProject do\n use Mix.Project\n def project, do: [app: :browser_fixture, version: "0.1.0", elixir: "~> 1.19"]\nend\n');
  await writeFile(join(root, 'lib/target.ex'), 'defmodule Target do\n def run, do: :ok\nend\n');
  await writeFile(join(root, 'lib/caller.ex'), 'defmodule Caller do\n def run, do: :ok\nend\n');
  const {page,url,errors} = await openProject(t,root);
  await page.getByRole('combobox', {name:'Visualization type'}).waitFor({timeout:45000});
  await page.getByRole('combobox', {name:'Visualization type'}).selectOption('graph');
  await page.getByRole('tab', {name:'Files',exact:true}).click();
  assert.equal(await page.locator('.tree-file').filter({hasText:'README.md'}).count(), 1);
  assert.equal(await page.locator('.tree-folder .tree-name').filter({hasText:/^test$/}).count(), 1);
  async function graphWithEdges(count) {
    for (let i=0;i<60;i++) {
      const graph = await (await page.request.get(new URL('/__codeflow/beam',url).href)).json();
      if (graph.status==='ready' && graph.edges.length===count && graph.producer.buildPath) return graph;
      await page.waitForTimeout(1000);
    }
    assert.fail('ElixirLS compiler graph did not reach '+count+' edges');
  }
  assert.equal((await graphWithEdges(0)).producer.buildPath, '.elixir_ls/build/dev');
  await writeFile(join(root,'lib/caller.ex'), 'defmodule Caller do\n def run, do: Target.run()\nend\n');
  assert.equal((await graphWithEdges(1)).edges[0].target, 'lib/target.ex');
  // Assert what is drawn, not the project-wide count: an edge can exist in
  // the data while folder aggregation silently hides it from the person.
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('.canvas-area svg circle.nc')];
    return ['lib/caller.ex', 'lib/target.ex', 'test/target_test.exs', 'README.md'].every(path =>
      nodes.some(el => el.__data__?.id === path && el.getBoundingClientRect().width > 0));
  });
  const renderedPaths = await page.locator('.canvas-area svg circle.nc').evaluateAll(els => els.map(el => el.__data__.id));
  assert.ok(renderedPaths.every(path => !path.startsWith('folder:')), 'Graph keeps files as nodes');
  await page.waitForFunction(() => [...document.querySelectorAll('.canvas-area svg path')].some(el => {
    const edge = el.__data__;
    return edge?.source?.id === 'lib/target.ex' && edge?.target?.id === 'lib/caller.ex'
      && edge.kind === 'runtime' && el.getAttribute('d')?.length > 0
      && Number(getComputedStyle(el).strokeOpacity) > 0;
  }));
  // The native Block Diagram must consume the real worker's parsed modules,
  // and be a navigable overview rather than an inert picture.
  const visualization=page.getByRole('combobox',{name:'Visualization type'});
  await visualization.selectOption('architecture');
  const targetBlock=page.locator('.architecture-pan svg').getByRole('button',{name:'Target',exact:true});
  await targetBlock.waitFor();
  await targetBlock.click();
  await page.locator('[data-architecture-block]').getByRole('button',{name:'lib/target.ex',exact:true}).waitFor();
  await page.getByRole('button',{name:/← Caller · runtime reference/}).click();
  await page.locator('[data-architecture-block]').getByRole('button',{name:'lib/caller.ex',exact:true}).click();
  await page.locator('[data-code-card="lib/caller.ex"]').waitFor();
  await visualization.selectOption('architecture');
  await page.locator('[data-architecture-block]').getByRole('button',{name:'lib/caller.ex',exact:true}).waitFor();
  await visualization.selectOption('graph');
  // Reload the edited source so definition navigation exercises the ordinary,
  // unchanged-source renderer rather than only the diff renderer.
  await page.reload();
  await page.getByRole('combobox', {name:'Visualization type'}).waitFor();
  await page.getByRole('tab', {name:'Files',exact:true}).click();
  await page.locator('.tree-folder').filter({has:page.locator('.tree-name').filter({hasText:/^lib$/})}).locator('.tree-toggle').click();
  await page.locator('.tree-file').filter({hasText:'caller.ex'}).click();
  await page.getByRole('button',{name:'run/0',exact:true}).click();
  const caller = page.locator('[data-code-card="lib/caller.ex"]');
  await caller.locator('[data-line="2"].highlighted').waitFor();
  await page.waitForTimeout(400); // Let the native camera transition settle before measuring text.
  const point = await caller.locator('[data-line="2"] .file-preview-text').evaluate(el => {
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    let node;
    while ((node=walker.nextNode())) {
      const at=node.textContent.indexOf('Target');
      if(at<0)continue;
      const range=document.createRange();range.setStart(node,at+2);range.setEnd(node,at+3);
      const box=range.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};
    }
  });
  assert.ok(point, 'call target is rendered');
  const modifier=process.platform==='darwin'?'Meta':'Control';
  await page.keyboard.down(modifier);await page.mouse.click(point.x,point.y);await page.keyboard.up(modifier);
  const target=page.locator('[data-code-card="lib/target.ex"]');
  await target.waitFor();
  await page.getByRole('button',{name:'run/0',exact:true}).locator('..').getByRole('button',{name:'Refs',exact:true}).click();
  await page.getByRole('button',{name:'lib/caller.ex:2',exact:true}).waitFor();
  await page.waitForTimeout(500);
  const header=await target.locator('.code-card-head').boundingBox();
  await page.mouse.move(header.x+60,header.y+15);await page.mouse.down();await page.mouse.move(header.x+100,header.y+55,{steps:8});await page.mouse.up();
  await page.waitForTimeout(1500);
  const layout = () => page.locator('[data-code-card]').evaluateAll(els=>els.map(el=>({path:el.dataset.codeCard,left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height})));
  const before=await layout();assert.equal(before.length,2);
  await page.reload();await target.waitFor();await page.waitForTimeout(1200);
  assert.deepEqual(await layout(),before);
  await page.getByRole('button',{name:'Close target.ex',exact:true}).click();
  assert.equal(await target.count(),0);assert.equal(await caller.count(),1);
  await page.getByRole('button',{name:'Close caller.ex',exact:true}).click();
  // Wait through the normal persistence interval so re-seeding cannot pass
  // merely by occurring after an immediate DOM assertion.
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('[data-code-card]').count(),0);
  await page.reload();await page.getByRole('combobox',{name:'Visualization type'}).waitFor();await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-code-card]').count(),0,'an intentionally empty workspace stays empty after reload');
  assert.deepEqual(errors,[]);
});

// This fixture deliberately has no Mix project: persistence is shared app
// behavior and must not depend on the Elixir provider being present.
test('JavaScript workspace restores Graph selection and open Code cards', {
  skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 60000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-js-browser-'));
  await writeFile(join(root, 'target.js'), 'export function target() { return 42; }\n');
  await writeFile(join(root, 'caller.js'), "import { target } from './target.js';\nexport function caller() { return target(); }\n");
  const {page,url,errors} = await openProject(t,root);
  const selector=page.getByRole('combobox',{name:'Visualization type'});
  await selector.waitFor();
  const status=await (await page.request.get(new URL('/__codeflow/status',url).href)).json();
  assert.equal(status.beam,false,'exercise the ordinary JavaScript project path');
  await selector.selectOption('graph');
  await page.getByRole('tab',{name:'Files',exact:true}).click();
  await page.locator('.tree-file').filter({hasText:'caller.js'}).click();
  await page.waitForTimeout(1200);
  await page.reload();
  await selector.waitFor();
  assert.equal(await selector.inputValue(),'graph');
  await page.getByRole('tab',{name:'Files',exact:true}).click();
  await page.locator('.tree-file.active').filter({hasText:'caller.js'}).waitFor();
  await selector.selectOption('code');
  const caller=page.locator('[data-code-card="caller.js"]');
  await caller.waitFor();
  await page.locator('.tree-file').filter({hasText:'target.js'}).click();
  const target=page.locator('[data-code-card="target.js"]');
  await target.waitFor();
  await page.waitForTimeout(500);
  const header=await target.locator('.code-card-head').boundingBox();
  await page.mouse.move(header.x+60,header.y+15);await page.mouse.down();
  await page.mouse.move(header.x+130,header.y+65,{steps:8});await page.mouse.up();
  await page.waitForTimeout(1200);
  const layout=()=>page.locator('[data-code-card]').evaluateAll(els=>els.map(el=>({path:el.dataset.codeCard,left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height})));
  const before=await layout();assert.equal(before.length,2);
  await page.reload();await target.waitFor();await page.waitForTimeout(1000);
  assert.equal(await selector.inputValue(),'code');
  assert.deepEqual(await layout(),before,'both cards and their user placement survive a reload');
  assert.match(await caller.innerText(),/return target\(\)/);
  assert.match(await target.innerText(),/return 42/);
  assert.deepEqual(errors,[]);
});

test('project investigation follows search, graph relationships and back/forward history', {skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:90000}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-investigation-'));
 await mkdir(join(root,'src'));
 await writeFile(join(root,'src/target.js'),'export function target() { return 42; }\nexport function anotherTarget() { return 43; }');
 await writeFile(join(root,'src/caller.js'),"import {target} from './target.js';\nexport function caller() { return target(); }");
 const {page,url,errors}=await openProject(t,root);
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor({timeout:45000});
 await page.getByRole('combobox',{name:'Visualization type'}).selectOption('graph');
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 const search=page.getByRole('searchbox',{name:'Find files and symbols'});
 await search.fill('target.js');await search.press('Enter');
 await page.locator('.panel-header .panel-title').filter({hasText:'target.js'}).waitFor();
 await search.fill('caller.js');await search.press('Enter');
 await page.locator('.panel-header .panel-title').filter({hasText:'caller.js'}).waitFor();
 // A dependency stays emphasized while its consumer is selected.
 await page.waitForFunction(()=>Number([...document.querySelectorAll('circle.nc')].find(n=>n.__data__.id==='src/target.js')?.getAttribute('opacity'))===1);
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.locator('.panel-header .panel-title').filter({hasText:'target.js'}).waitFor();
 await page.getByRole('button',{name:'Forward',exact:true}).click();
 await page.locator('.panel-header .panel-title').filter({hasText:'caller.js'}).waitFor();
 await search.fill('target');
 await page.locator('button.tree-file').filter({hasText:'src/target.js:1'}).click();
 await page.locator('[data-code-card="src/target.js"] [data-line="1"].highlighted').waitFor();
 assert.equal(await page.getByRole('combobox',{name:'Visualization type'}).inputValue(),'code');
 await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('codeflow:workspace:')&&JSON.parse(localStorage.getItem(k)).navigation?.entries.length>=3));
 await page.reload();await page.getByRole('combobox',{name:'Visualization type'}).waitFor({timeout:45000});
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.locator('.panel-header .panel-title').filter({hasText:'caller.js'}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'Visualization type'}).inputValue(),'graph');
 await search.fill('anotherTarget');await search.press('Enter');
 await page.locator('[data-code-card="src/target.js"] [data-line="2"].highlighted').waitFor();
 await search.fill('target');await page.locator('button.tree-file').filter({hasText:'src/target.js:1'}).click();
 await page.locator('[data-code-card="src/target.js"] [data-line="1"].highlighted').waitFor();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.locator('[data-code-card="src/target.js"] [data-line="2"].highlighted').waitFor();
 await page.getByRole('button',{name:'Forward',exact:true}).click();
 await page.locator('[data-code-card="src/target.js"] [data-line="1"].highlighted').waitFor();
 assert.deepEqual(errors,[]);
});


test('runtime investigation returns from source to the actual supervised process', {skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:90000}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-runtime-browser-'));
 const node=`codeflow_browser_${process.pid}@${hostname().split('.')[0]}`;
 const cookie='codeflow_browser_disposable';
 await writeFile(join(root,'worker.exs'),`defmodule BrowserWorker do
 use GenServer
 def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
 def init(_), do: {:ok, nil}
end
defmodule BrowserApplication do
 use Application
 def start(_, _), do: Supervisor.start_link([BrowserWorker], strategy: :one_for_one)
end
:application.load({:application, :browser_runtime, [{:description, ~c"Browser runtime"}, {:vsn, ~c"1"}, {:modules, [BrowserApplication, BrowserWorker]}, {:registered, []}, {:applications, [:kernel, :stdlib, :elixir]}, {:mod, {BrowserApplication, []}}]})
:ok = Application.start(:browser_runtime)
IO.puts("READY")
Process.sleep(:infinity)
`);
 const runtime=spawn('elixir',['--sname',node,'--cookie',cookie,join(root,'worker.exs')],{stdio:['ignore','pipe','pipe']});
 t.after(()=>runtime.kill('SIGTERM'));
 await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(new Error(output)),15000);
  runtime.stdout.on('data',chunk=>{output+=chunk;if(output.includes('READY')){clearTimeout(timer);resolve();}});
  runtime.stderr.on('data',chunk=>{output+=chunk;});
  runtime.once('exit',code=>{clearTimeout(timer);reject(new Error('Runtime exited '+code+': '+output));});
 });
 const {page,errors}=await openProject(t,root,{args:['--beam','--source-only'],env:{CODEFLOW_BEAM_COOKIE:cookie}});
 await page.getByRole('button',{name:'RUNTIME',exact:true}).click();
 await page.getByRole('textbox',{name:'BEAM node'}).fill(node);
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByRole('button',{name:'Refresh',exact:true}).waitFor({timeout:30000});
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.getByRole('searchbox',{name:'Find files and symbols'}).fill('worker.exs');
 await page.getByRole('searchbox',{name:'Find files and symbols'}).press('Enter');
 const processButton=page.locator('.card').filter({hasText:'Running processes'}).getByRole('button').filter({hasText:'BrowserWorker'}).first();
 await processButton.click();
 const focused=page.locator('[data-process-id][style*="outline"]');
 await focused.waitFor();
 assert.ok(await focused.isVisible(),'source expands the application and reveals its supervised runtime process');
 assert.match(await focused.innerText(),/queue.* B .*reductions/);
 await focused.getByRole('button',{name:'Source',exact:true}).click();
 await page.locator('[data-code-card="worker.exs"]').waitFor();
 // Another project can contain the same path without owning this node's processes.
 const other=await mkdtemp(join(tmpdir(),'codeflow-other-runtime-project-'));
 t.after(()=>rm(other,{recursive:true,force:true}));
 await writeFile(join(other,'worker.exs'),'defmodule OtherWorker do\n def run(), do: :ok\nend');
 await page.locator('input[type="file"][webkitdirectory]').setInputFiles(other);
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor();
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 const search=page.getByRole('searchbox',{name:'Find files and symbols'});
 await search.fill('OtherWorker.run/0');await search.press('Enter');
 await page.locator('[data-code-card="worker.exs"] [data-line="2"].highlighted').waitFor();
 assert.equal(await page.locator('.card').filter({hasText:'Running processes'}).count(),0,'the previous project runtime must not attach to this source');
 assert.deepEqual(errors,[]);
});


test('large architecture maps fit completely and selected blocks become readable without losing relationships', {skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:90000}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-architecture-browser-'));
 await Promise.all(Array.from({length:60},(_,i)=>writeFile(join(root,`target_${i}.ex`),`defmodule Target${i} do\n def run, do: :ok\nend`)));
 await writeFile(join(root,'caller.ex'),'defmodule Caller do\n def run do\n'+Array.from({length:60},(_,i)=>` Target${i}.run()`).join('\n')+'\n end\nend');
 const {page,errors}=await openProject(t,root);
 const views=page.getByRole('combobox',{name:'Visualization type'});await views.waitFor({timeout:45000});await views.selectOption('architecture');
 const svg=page.locator('.architecture-pan svg');await svg.waitFor();
 await page.getByRole('button',{name:'Fit view',exact:true}).click();
 await page.waitForTimeout(200);
 const frame=await page.locator('.mermaid-render').boundingBox(),overview=await svg.boundingBox();
 assert.ok(overview.width<=frame.width&&overview.height<=frame.height,'fit does not clip a large diagram at an arbitrary minimum scale');
 assert.equal(await svg.locator('path.flowchart-link').count(),60,'all60 source relationships are drawn');
 await page.locator('.panel-content').getByRole('button',{name:'Caller',exact:true}).click();
 const block=svg.getByRole('button',{name:'Caller',exact:true});await page.waitForTimeout(200);
 const bounds=await block.boundingBox();
 assert.ok(bounds.height>=30,'selected block is legible at normal reading scale');
 assert.ok(Math.abs(bounds.x+bounds.width/2-frame.x-frame.width/2)<4,'selected block is centered');
 assert.equal(await page.locator('.panel-content').evaluate(el=>el.scrollTop),0,'details start at their heading');
 assert.equal(await svg.locator('path.flowchart-link title').count(),60,'relationship evidence remains available on hover');
 assert.deepEqual(errors,[]);
});

test('3D graph mounts the native renderer and returns to the same file graph', {
  skip: !process.env.CODEFLOW_TEST_BROWSER, timeout:60000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(),'codeflow-graph3d-'));
  await writeFile(join(root,'provider.js'),'export function provide() { return 1; }');
  await writeFile(join(root,'consumer.js'),"import { provide } from './provider.js'; export function consume() { return provide(); }");
  const {page,errors} = await openProject(t,root);
  const mode = page.getByRole('combobox',{name:'Visualization type'});
  await mode.waitFor();
  await mode.selectOption('graph');
  await page.waitForFunction(()=>document.querySelectorAll('.canvas-area svg circle.nc').length===2&&[...document.querySelectorAll('.canvas-area svg path')].some(el=>el.__data__?.source?.id==='provider.js'&&el.__data__?.target?.id==='consumer.js'));
  const before = await page.locator('.canvas-area svg circle.nc').evaluateAll(nodes=>nodes.map(node=>node.__data__.id).sort());
  await mode.selectOption('graph3d');
  await page.locator('.graph3d-container canvas').waitFor({state:'visible'});
  assert.ok(await page.locator('.graph3d-container canvas').evaluate(canvas=>canvas.width>0&&canvas.height>0));
  await mode.selectOption('graph');
  await page.waitForFunction(()=>document.querySelectorAll('.canvas-area svg circle.nc').length===2&&[...document.querySelectorAll('.canvas-area svg path')].some(el=>el.__data__?.source?.id==='provider.js'&&el.__data__?.target?.id==='consumer.js'));
  assert.deepEqual(await page.locator('.canvas-area svg circle.nc').evaluateAll(nodes=>nodes.map(node=>node.__data__.id).sort()),before);
  assert.equal(await page.locator('.graph3d-container').count(),0);
  await mode.selectOption('graph3d');
  await page.locator('.graph3d-container canvas').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
});

test('closing the selected Code card reveals the surviving card outside the current folder', {
  skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 60000
}, async t => {
  const root=await mkdtemp(join(tmpdir(),'codeflow-scope-close-'));
  for (const name of ['alpha','beta']) {
    await mkdir(join(root,name));
    await writeFile(join(root,name,name+'.js'),`export function ${name}() { return 42; }\n`);
  }
  const {page,errors}=await openProject(t,root);
  const selector=page.getByRole('combobox',{name:'Visualization type'});
  await selector.waitFor();
  await page.getByRole('tab',{name:'Files',exact:true}).click();
  const search=page.getByRole('searchbox',{name:'Find files and symbols'});
  await search.fill('beta.js');await search.press('Enter');
  await selector.selectOption('code');
  await page.locator('[data-code-card="beta/beta.js"]').waitFor();
  await search.fill('alpha.js');await search.press('Enter');
  await page.locator('[data-code-card="alpha/alpha.js"]').waitFor();
  await search.fill('');
  await page.locator('.tree-folder').filter({has:page.locator('.tree-name').filter({hasText:/^alpha$/})}).click();
  await page.locator('.tree-folder.filtered').waitFor();
  assert.equal(await page.locator('[data-code-card="beta/beta.js"]').count(),0);
  await page.getByRole('button',{name:'Close alpha.js',exact:true}).click();
  await page.locator('[data-code-card="beta/beta.js"]').waitFor();
  assert.equal(await page.locator('.tree-folder.filtered').count(),0);
  await page.locator('.panel-header .panel-title').filter({hasText:'beta.js'}).waitFor();
  // A card in the DOM is insufficient: its controls must be reachable after
  // the selection and folder scope change together.
  await page.getByRole('button',{name:'Close beta.js',exact:true}).click();
  assert.equal(await page.locator('[data-code-card]').count(),0);
  assert.deepEqual(errors,[]);
});

test('Code history and reload restore the saved camera without recentering the selected card', {
  skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 60000
}, async t => {
  const root=await mkdtemp(join(tmpdir(),'codeflow-camera-history-'));
  await writeFile(join(root,'first.js'),'export function first() { return 1; }');
  await writeFile(join(root,'second.js'),'export function second() { return 2; }');
  const {page,errors}=await openProject(t,root);
  const selector=page.getByRole('combobox',{name:'Visualization type'});
  await selector.waitFor();
  await page.getByRole('tab',{name:'Files',exact:true}).click();
  await page.locator('.tree-file').filter({hasText:'first.js'}).click();
  await selector.selectOption('code');
  await page.locator('[data-code-card="first.js"]').waitFor();
  await page.waitForTimeout(600);
  const camera=()=>page.locator('.canvas-area svg').first().evaluate(el=>({x:el.__zoom.x,y:el.__zoom.y,k:el.__zoom.k}));
  await page.mouse.move(750,700);await page.mouse.wheel(0,350);
  await page.waitForTimeout(600);
  const before=await camera();
  await page.locator('.tree-file').filter({hasText:'second.js'}).click();
  await page.locator('[data-code-card="second.js"]').waitFor();
  await page.waitForTimeout(600);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.waitForTimeout(700);
  assert.deepEqual(await camera(),before,'Back restores the previous camera');
  await page.waitForTimeout(1200);
  await page.reload();await page.locator('[data-code-card="first.js"]').waitFor();
  await page.waitForTimeout(700);
  assert.deepEqual(await camera(),before,'reload preserves the saved camera');
  assert.deepEqual(errors,[]);
});
