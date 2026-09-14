import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('assessment findings color native files, open source and refresh without stale selection',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-findings-'));
 const lines=Array.from({length:80},(_,i)=>'// line '+(i+1));
 lines[39]='export function provide() { return 1; }';
 await writeFile(join(root,'provider.js'),lines.join('\n'));
 await writeFile(join(root,'consumer.js'),"import {provide} from './provider.js'; provide();");
 const analysis={assessment:{status:'ready',findings:[{path:'provider.js',message:'Prefer clearer function naming',severity:2,check:'Credo.Check.Readability.FunctionNames',range:{start:{line:39,character:16},end:{line:39,character:23}}}]},session:{status:()=>({state:'ready',diagnostics:[]}),dispose(){}}};
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname,analysis,beamGraph:{schemaVersion:1,status:'ready',nodes:[],edges:[],warnings:[]}});
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
 await page.waitForFunction(()=>document.querySelectorAll('circle.nc').length===2);
 const graph=()=>page.locator('.canvas-area svg').filter({has:page.locator('circle.nc')}).evaluate(el=>({nodes:[...el.querySelectorAll('circle.nc')].map(n=>n.__data__.id).sort(),edges:[...el.querySelectorAll('path')].filter(n=>n.__data__?.source?.id).map(n=>[n.__data__.source.id,n.__data__.target.id]).sort()}));
 const before=await graph();
 assert.deepEqual(before.nodes,['consumer.js','provider.js']);
 assert.ok(before.edges.some(([from,to])=>from==='provider.js'&&to==='consumer.js'));
 // Observe the real WebGL renderer through its public factory, as in the
 // native 3D pointer regression; no application state is injected.
 await page.evaluate(()=>{
  const factory=window.ForceGraph3D;
  window.ForceGraph3D=(...options)=>{
   const mount=factory(...options);
   return element=>{const g=mount(element);g.cooldownTime(150);window.__findings3d=g;return g;};
  };
 });
 await mode.selectOption('graph3d');
 await page.locator('.graph3d-container canvas').waitFor();
 await page.waitForTimeout(500); // Settle the real physics before changing only its palette.
 const canvas3d=await page.locator('.graph3d-container canvas').elementHandle();
 const scene=()=>page.evaluate(()=>{const g=window.__findings3d;return {nodes:g.graphData().nodes.map(n=>({id:n.id,x:n.x,y:n.y,z:n.z})),camera:g.cameraPosition()};});
 const settled=await scene();
 await page.evaluate(()=>{const g=window.__findings3d;window.__sceneNodes=g.graphData().nodes;window.__folderForce=g.d3Force('x');});
 await page.getByRole('button',{name:'Findings',exact:true}).click();
 await page.waitForTimeout(500);
 assert.deepEqual(await scene(),settled,'3D color changes preserve settled positions and camera');
 assert.equal(await page.evaluate(()=>window.__findings3d.graphData().nodes===window.__sceneNodes),true,'coloring preserves native topology');
 assert.equal(await page.evaluate(()=>window.__findings3d.d3Force('x')===window.__folderForce),true,'folder physics is independent of the legend');
 assert.equal(await canvas3d.evaluate(el=>el===document.querySelector('.graph3d-container canvas')),true);
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-file').filter({hasText:'provider.js'}).click();
 await page.waitForFunction(()=>{const g=window.__findings3d,n=g.graphData().nodes.find(n=>n.id==='provider.js');return g.nodeColor()(n)==='rgba(255,159,67,0.95)';});
 assert.deepEqual(await scene(),settled,'file selection retains severity and settled scene');
 await page.getByRole('button',{name:'← Back to Issues',exact:true}).click();
 await mode.selectOption('graph');

 await page.waitForFunction(()=>[...document.querySelectorAll('circle.nc')].find(n=>n.__data__.id==='provider.js')?.getAttribute('fill')==='#ff9f43');
 assert.deepEqual(await graph(),before,'findings color leaves actual files and dependencies intact');
 assert.equal(await page.locator('circle.nc').evaluateAll(nodes=>nodes.find(n=>n.__data__.id==='consumer.js').getAttribute('fill')),'#8b9099');
 const nodeIndex=await page.locator('circle.nc').evaluateAll(nodes=>nodes.findIndex(n=>n.__data__.id==='provider.js'));
 await page.locator('circle.nc').nth(nodeIndex).click();
 const findings=page.getByLabel('File findings',{exact:true});
 await findings.getByRole('button',{name:/Prefer clearer function naming/}).click();
 const line=page.locator('[data-code-card="provider.js"] [data-line="40"].highlighted');
 await line.waitFor();
 await page.waitForTimeout(600);
 assert.equal(await line.evaluate(el=>{const r=el.getBoundingClientRect(),b=el.closest('.code-card-body').getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom;}),true,'finding opens its exact visible source line');
 await mode.selectOption('graph');
 analysis.assessment={status:'ready',findings:[]};
 await page.waitForFunction(()=>{const node=[...document.querySelectorAll('circle.nc')].find(n=>n.__data__.id==='provider.js');return node&&getComputedStyle(node).fill==='rgb(139, 144, 153)';});
 assert.equal(await findings.count(),0,'selected file drops removed diagnostics');
 assert.deepEqual(await graph(),before);
 assert.deepEqual(errors,[]);
});
