import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('alternate D3 views retain their camera through source selection and resize, and release their scene',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:90000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-alternate-'));
 for(const folder of ['lib','ui'])await mkdir(join(root,folder));
 await writeFile(join(root,'lib/provider.js'),'export function provide() { return 1; }');
 await writeFile(join(root,'ui/consumer.js'),"import {provide} from '../lib/provider.js'; export function consume() { return provide(); }");
 await writeFile(join(root,'ui/other.js'),"import {consume} from './consumer.js'; consume();");
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{if(browser)await browser.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 const mode=page.getByRole('combobox',{name:'Visualization type'});
 await mode.selectOption('graph');
 await page.waitForFunction(()=>document.querySelectorAll('circle.nc').length===3);
 await page.getByRole('button',{name:'Findings',exact:true}).click();
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-folder').filter({has:page.getByText('lib',{exact:true})}).locator('.tree-toggle').click();
 const choices=[['treemap','.treemap-cell-g'],['matrix','.row-label'],['dendro','.dendro-node'],['disjoint','.disjoint-node'],['bundle','.bundle-circle']];
 for(const [view,selector] of choices){
  await mode.selectOption(view);
  const container=page.locator('.'+view+'-container'),svg=container.locator('svg');
  await svg.waitFor();await page.waitForTimeout(300);
  assert.equal(await page.locator('.legend-title').textContent(),'Folders',view+' legend describes its actual folder palette');
  const bounds=await svg.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,160);await page.waitForTimeout(300);
  const camera=await svg.evaluate(el=>({x:el.__zoom.x,y:el.__zoom.y,k:el.__zoom.k}));
  assert.notEqual(camera.k,1,view+' accepts real wheel zoom');
  const scene=await svg.elementHandle();
  const index=await container.locator(selector).evaluateAll(nodes=>nodes.findIndex(node=>(node.__data__.data?.path||node.__data__.path||node.__data__.id)==='lib/provider.js'));
  assert.ok(index>=0,view+' contains the actual provider file');
  // Files selection must update inspection without rebuilding or recentering the chart.
  await page.locator('.tree-file').filter({hasText:'provider.js'}).click();
  await page.getByRole('button',{name:'← Back to Issues',exact:true}).waitFor();
  assert.equal(await scene.evaluate(el=>el.isConnected),true,view+' selection retains its SVG');
  assert.deepEqual(await svg.evaluate(el=>({x:el.__zoom.x,y:el.__zoom.y,k:el.__zoom.k})),camera,view+' selection retains camera');
  await page.getByRole('button',{name:'← Back to Issues',exact:true}).click();
  await container.locator(selector).nth(index).click();
  await page.locator('.panel-title').filter({hasText:'provider.js'}).waitFor();
  await page.getByRole('button',{name:'View Source',exact:true}).click();
  await page.locator('.file-preview-modal').waitFor();
  await page.locator('.file-preview-close').click();
  // Resizing owns the SVG dimensions and preserves this view's pan/zoom.
  await page.setViewportSize({width:1400,height:900});await page.waitForTimeout(300);
  const resized=await svg.boundingBox(),frame=await container.boundingBox();
  assert.equal(Math.round(resized.width),Math.round(frame.width),view+' tracks container width');
  assert.equal(Math.round(resized.height),Math.round(frame.height),view+' tracks container height');
  assert.deepEqual(await svg.evaluate(el=>({x:el.__zoom.x,y:el.__zoom.y,k:el.__zoom.k})),camera,view+' resize retains camera');
  if(view==='disjoint'){
   const node=await container.locator('.disjoint-node').first().elementHandle();
   await mode.selectOption('graph');
   const stopped=await node.evaluate(el=>({x:el.__data__.x,y:el.__data__.y}));
   await page.waitForTimeout(250);
   assert.deepEqual(await node.evaluate(el=>({x:el.__data__.x,y:el.__data__.y})),stopped,'unmounted Disjoint stops physics');
  }
  await mode.selectOption('graph');
  assert.equal(await container.count(),0,view+' releases its container');
  await page.setViewportSize({width:1500,height:1000});
 }
 // Both folder-oriented navigation surfaces use the shared project scope.
 for(const view of ['dendro','sankey']){
  await mode.selectOption(view);
  const nodes=page.locator('.'+view+'-node');
  await nodes.first().waitFor();
  const index=await nodes.evaluateAll(nodes=>nodes.findIndex(node=>(node.__data__.data?.fullPath||node.__data__.fullPath)==='lib'));
  assert.ok(index>=0);await nodes.nth(index).click();
  await page.getByRole('button',{name:/Clear Filter: lib/}).waitFor();
  await page.getByRole('button',{name:/Clear Filter: lib/}).click();
 }
 assert.deepEqual(errors,[]);
});
