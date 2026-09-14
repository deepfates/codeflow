import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('Flow folder scope retains boundary relationships and reveals the existing file tree',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-flow-scope-'));
 const files={
  'src/core/consumer.js':"import {provide} from '../../lib/provider/provider.js'; export function consume() { return provide(); }",
  'src/core_extra/sibling.js':'export function sibling() { return 1; }',
  'lib/provider/provider.js':"import {consume} from '../../src/core/consumer.js'; export function provide() { return consume(); }",
  'lib/provider/extra.js':'export function extra() { return 1; }',
  'tests/check/check.js':"import {consume} from '../../src/core/consumer.js'; export function check() { return consume(); }",
  'unrelated/other.js':"import {provide} from '../lib/provider/provider.js'; export function other() { return provide(); }",
 };
 for(const [path,content] of Object.entries(files)){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content);}
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 const mode=page.getByRole('combobox',{name:'Visualization type'});await mode.selectOption('sankey');
 const scene=page.locator('.sankey-container'),nodes=scene.locator('.sankey-node');await nodes.first().waitFor({timeout:45000});
 const links=()=>scene.locator('.sankey-link').evaluateAll(ns=>ns.map(n=>({source:n.__data__.source.fullPath,target:n.__data__.target.fullPath,value:n.__data__.value})).sort((a,b)=>(a.source+a.target).localeCompare(b.source+b.target)));
 const all=await links(),expected=all.filter(l=>l.source==='src/core'||l.target==='src/core');
 assert.equal(expected.length,3);
 const index=await nodes.evaluateAll(ns=>ns.findIndex(n=>n.__data__.fullPath==='src/core'));await nodes.nth(index).click();
 await page.waitForFunction(()=>document.querySelectorAll('.sankey-node').length===3);
 assert.deepEqual(await links(),expected,'scope retains all original incident directions and weights');
 const visible=await nodes.evaluateAll(ns=>ns.map(n=>({path:n.__data__.fullPath,files:n.__data__.fileCount})).sort((a,b)=>a.path.localeCompare(b.path)));
 assert.deepEqual(visible,[{path:'lib/provider',files:2},{path:'src/core',files:1},{path:'tests/check',files:1}],'no prefix sibling or second-hop neighbor; boundary counts come from full model');
 assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true','scope preserves active sidebar tab');
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:/Clear Filter: src\/core/}).waitFor();
 const consumer=page.locator('.tree-file').filter({hasText:'consumer.js'});await consumer.waitFor();await consumer.click();
 await page.locator('.panel-header .panel-title').filter({hasText:'consumer.js'}).waitFor();
 await page.getByRole('button',{name:'View Source',exact:true}).click();
 await page.locator('.file-preview-code').filter({hasText:'return provide()'}).waitFor();
 assert.deepEqual(errors,[]);
});
