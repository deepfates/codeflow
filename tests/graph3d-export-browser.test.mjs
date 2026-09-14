import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('3D image export downloads the rendered scene without changing the camera',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-3d-export-'));
 await writeFile(join(root,'provider.js'),'export function provide() { return 1; }');
 await writeFile(join(root,'consumer.js'),"import {provide} from './provider.js'; provide();");
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Retain the ordinary native renderer only for observing camera continuity.
 await page.addInitScript(()=>{
  let factory;
  Object.defineProperty(window,'ForceGraph3D',{configurable:true,get:()=>factory,set(value){
   factory=(...args)=>{const make=value(...args);return (...mountArgs)=>{const graph=make(...mountArgs);window.exportTestGraph=graph;return graph;};};
  }});
 });
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.getByRole('combobox',{name:'Visualization type'}).selectOption('graph3d');
 await page.waitForFunction(()=>window.exportTestGraph?.graphData().nodes.length===2);
 await page.waitForTimeout(700);
 const before=await page.evaluate(()=>({...window.exportTestGraph.cameraPosition()}));
 const dimensions=await page.locator('.graph3d-container canvas').evaluate(el=>({width:el.width,height:el.height}));
 await page.getByRole('button',{name:'Export analysis',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:5000}),page.getByText('PNG Image',{exact:true}).click({timeout:5000})]);
 const bytes=await readFile(await download.path());
 assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const pixels=await page.evaluate(async encoded=>{
  const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');context.drawImage(image,0,0);
  const data=context.getImageData(0,0,image.width,image.height).data,colors=new Set();
  for(let i=0;i<data.length;i+=4)if(data[i+3])colors.add(data[i]+','+data[i+1]+','+data[i+2]);
  return {width:image.width,height:image.height,colors:colors.size};
 },bytes.toString('base64'));
 assert.equal(pixels.width,dimensions.width);assert.equal(pixels.height,dimensions.height);
 assert.ok(pixels.colors>10,'image contains rendered geometry rather than an empty WebGL buffer');
 assert.deepEqual(await page.evaluate(()=>({...window.exportTestGraph.cameraPosition()})),before);
 assert.deepEqual(errors,[]);
});
