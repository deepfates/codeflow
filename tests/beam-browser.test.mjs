import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

async function openProject(t,root) {
  const { chromium } = await import('playwright');
  const server = spawn(process.execPath, [fileURLToPath(new URL('../cli/codeflow.mjs', import.meta.url)), root, '--port', '0', '--no-open'], {stdio:['ignore','pipe','pipe']});
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
  assert.equal(await page.locator('[data-code-card]').count(),0);
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
