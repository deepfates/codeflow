import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('Graph color modes preserve the scene and restore current colors after hover and deselection',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000
},async t=>{
 const fixture=await mkdtemp(join(tmpdir(),'codeflow-colors-'));
 await mkdir(join(fixture,'lib'));
 await writeFile(join(fixture,'lib','unsafe.js'),'export function execute(input) { return eval(input); }');
 await writeFile(join(fixture,'main.js'),"import {execute} from './lib/unsafe.js'; export function main(input) { return execute(input); }");
 const root=process.env.CODEFLOW_COLOR_PROJECT||fixture;
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(fixture,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,channel:process.env.CODEFLOW_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.locator('.canvas-area circle.nc').first().waitFor();
 await page.waitForTimeout(5000);
 const canvas=await page.locator('.canvas-area circle.nc').first().evaluate(n=>{const r=n.ownerSVGElement.getBoundingClientRect();return {x:r.x+60,y:r.y+60};});
 await page.mouse.move(canvas.x,canvas.y);await page.mouse.wheel(0,-200);await page.waitForTimeout(300);
 let previousColors=await page.locator('.canvas-area circle.nc').evaluateAll(ns=>ns.map(n=>n.getAttribute('fill')));
 const before=await page.evaluate(()=>{
   window.colorNodes=[...document.querySelectorAll('.canvas-area circle.nc')];
   window.colorSVG=colorNodes[0].ownerSVGElement;
   window.colorSnapshot=()=>({camera:{...colorSVG.__zoom},positions:colorNodes.map(n=>[n.__data__.id,n.__data__.x,n.__data__.y])});
   return colorSnapshot();
 });
 for(const mode of ['Findings','Layer','Folder']){
   await page.getByRole('button',{name:mode,exact:true}).click();
   await page.waitForTimeout(300);
   const after=await page.evaluate(()=>({same:colorNodes.every(n=>n.isConnected),...colorSnapshot()}));
   assert.equal(after.same,true,mode+' must keep the existing SVG nodes');
   assert.deepEqual(after.camera,before.camera,mode+' must preserve camera');
   assert.deepEqual(after.positions,before.positions,mode+' must preserve settled positions');
   const colors=await page.locator('.canvas-area circle.nc').evaluateAll(ns=>ns.map(n=>n.getAttribute('fill')));
   if(!process.env.CODEFLOW_COLOR_PROJECT)assert.notDeepEqual(colors,previousColors,mode+' must actually recolor the graph');
   previousColors=colors;
   // Dispatch native events on an existing node, including offscreen nodes in real projects.
   await page.locator('.canvas-area circle.nc').first().evaluate(n=>{n.parentNode.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));n.parentNode.dispatchEvent(new MouseEvent('mouseleave',{bubbles:false}));n.parentNode.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
   await page.waitForTimeout(250);
   if(mode==='Findings')assert.deepEqual(await page.locator('.canvas-area circle.nc').evaluateAll(ns=>ns.map(n=>n.getAttribute('fill'))),colors,'selection preserves finding severity colors');
   await page.evaluate(()=>colorSVG.dispatchEvent(new MouseEvent('click',{bubbles:true})));
   await page.waitForTimeout(300);
   assert.deepEqual(await page.locator('.canvas-area circle.nc').evaluateAll(ns=>ns.map(n=>n.getAttribute('fill'))),colors,mode+' background deselection must restore current colors');
 }
 console.log(JSON.stringify({project:root,nodes:before.positions.length,camera:before.camera,colorModes:['Findings','Layer','Folder'],scenePreserved:true}));
 assert.deepEqual(errors,[]);
});
