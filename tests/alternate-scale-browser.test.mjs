import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('alternate layouts include late files and folders beyond former caps and expose them through native pan',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:90000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-alternate-scale-'));
 const paths=[];
 for(let i=0;i<126;i++){
  const folder='group'+String(Math.floor(i/6)).padStart(2,'0'),path=folder+'/file'+String(i).padStart(3,'0')+'.js';
  await mkdir(join(root,folder),{recursive:true});
  const previous=paths.at(-1);
  await writeFile(join(root,path),(previous?"import {f"+(i-1)+"} from '../"+previous+"';\n":'')+'export function f'+i+'() { return '+(previous?'f'+(i-1)+'()':'0')+'; }');
  paths.push(path);
 }
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
 await page.waitForFunction(()=>document.querySelectorAll('circle.nc').length===126);
 async function reveal(svg,target){
  // Travel across the actual larger SVG world using its ordinary D3 pan gesture.
  for(let attempt=0;attempt<30;attempt++){
   const frame=await svg.boundingBox(),box=await target.boundingBox();
   const x=box.x+box.width/2,y=box.y+box.height/2;
   if(x>frame.x+20&&x<frame.x+frame.width-20&&y>frame.y+20&&y<frame.y+frame.height-20)return;
   const dx=Math.max(-frame.width*0.6,Math.min(frame.width*0.6,frame.x+frame.width/2-x));
   const dy=Math.max(-frame.height*0.6,Math.min(frame.height*0.6,frame.y+frame.height/2-y));
   const start={x:frame.x+frame.width/2,y:frame.y+frame.height/2};
   await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+dx,start.y+dy,{steps:6});await page.mouse.up();
  }
  assert.fail('late entity did not become reachable with native pan');
 }
 for(const [view,selector] of [['dendro','.dendro-node'],['bundle','.bundle-node'],['disjoint','.disjoint-node']]){
  await mode.selectOption(view);
  const container=page.locator('.'+view+'-container'),svg=container.locator('svg');
  await svg.waitFor();
  if(view==='disjoint')await page.waitForTimeout(1500);
  const nodes=container.locator(selector);
  const actual=await nodes.evaluateAll(nodes=>nodes.map(n=>n.__data__.data?.path||n.__data__.id).filter(Boolean));
  assert.deepEqual(actual.sort(),paths.slice().sort(),view+' retains every file identity');
  if(view==='dendro'){
   const positions=await nodes.evaluateAll(nodes=>nodes.filter(n=>n.__data__.data?.path).map(n=>n.__data__.x).sort((a,b)=>a-b));
   assert.ok(positions.slice(1).every((value,i)=>value-positions[i]>=19),'dendrogram gives file labels readable world spacing');
  }
  const index=await nodes.evaluateAll(nodes=>nodes.findIndex(n=>(n.__data__.data?.path||n.__data__.id)==='group20/file125.js'));
  const target=nodes.nth(index).locator('circle');
  await reveal(svg,target);await target.click();
  await page.locator('.panel-title').filter({hasText:'file125.js'}).waitFor();
  await page.getByRole('button',{name:'← Back to Issues',exact:true}).click();
 }
 await mode.selectOption('sankey');
 const container=page.locator('.sankey-container'),svg=container.locator('svg'),nodes=container.locator('.sankey-node');
 await nodes.first().waitFor();
 assert.equal(await nodes.count(),21,'Sankey keeps every folder');
 assert.equal(await container.locator('.sankey-link').count(),20,'Sankey keeps every cross-folder dependency in this DAG');
 const index=await nodes.evaluateAll(nodes=>nodes.findIndex(node=>node.__data__.fullPath==='group20'));
 const target=nodes.nth(index).locator('rect');await reveal(svg,target);await target.click();
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:/Clear Filter: group20/}).waitFor();
 assert.deepEqual(errors,[]);
});
