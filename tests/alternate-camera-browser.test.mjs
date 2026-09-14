import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('alternate cameras survive mode changes and reload without crossing project workspaces',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:90000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-view-camera-'));
 const other=await mkdtemp(join(tmpdir(),'codeflow-view-camera-other-'));
 await mkdir(join(root,'lib'));await mkdir(join(root,'ui'));
 await writeFile(join(root,'lib/provider.js'),'export function provide() { return 1; }');
 await writeFile(join(root,'ui/consumer.js'),"import {provide} from '../lib/provider.js'; provide();");
 await writeFile(join(other,'different.js'),'export function different() { return 2; }');
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{if(browser)await browser.close();await app.close();await rm(root,{recursive:true,force:true});await rm(other,{recursive:true,force:true});});
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
 const saved={};
 const camera=svg=>svg.evaluate(el=>({x:el.__zoom.x,y:el.__zoom.y,k:el.__zoom.k}));
 for(const view of ['treemap','matrix','dendro','sankey','disjoint','bundle']){
  await mode.selectOption(view);
  const svg=page.locator('.'+view+'-container svg');
  await svg.waitFor();await page.waitForTimeout(150);
  const bounds=await svg.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,200);await page.waitForTimeout(200);
  await page.mouse.move(bounds.x+bounds.width-30,bounds.y+bounds.height-60);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width-110,bounds.y+bounds.height-100,{steps:6});await page.mouse.up();
  saved[view]=await camera(svg);
  await mode.selectOption('graph');await mode.selectOption(view);await svg.waitFor();
  assert.deepEqual(await camera(svg),saved[view],view+' reentry restores the same place');
  await page.waitForFunction(({view,expected})=>Object.keys(localStorage).filter(key=>key.startsWith('codeflow:workspace:')).some(key=>{
   const saved=JSON.parse(localStorage.getItem(key));return saved.view===view&&['x','y','k'].every(key=>saved.viewCameras?.[view]?.[key]===expected[key]);
  }),{view,expected:saved[view]});
  await page.reload();await page.waitForFunction(view=>document.querySelector('.'+view+'-container svg')?.__zoom,view);
  assert.equal(await mode.inputValue(),view);
  assert.deepEqual(await camera(svg),saved[view],view+' reload restores the persisted camera');
 }
 const firstRecord=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('codeflow:workspace:')).map(key=>[key,JSON.parse(localStorage.getItem(key)).viewCameras])));
 await page.locator('input[type="file"][webkitdirectory]').setInputFiles(other);
 await mode.selectOption('graph');
 await page.waitForFunction(()=>[...document.querySelectorAll('circle.nc')].some(node=>node.__data__.id.endsWith('different.js')));
 await mode.selectOption('treemap');const svg=page.locator('.treemap-container svg');await svg.waitFor();
 assert.notDeepEqual(await camera(svg),saved.treemap,'another project starts with its own camera');
 await page.waitForFunction(()=>Object.keys(localStorage).filter(key=>key.startsWith('codeflow:workspace:')).length===2);
 const oldRecords=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,JSON.parse(localStorage.getItem(key)).viewCameras])),Object.keys(firstRecord));
 assert.deepEqual(oldRecords,firstRecord,'new project and old view cleanup cannot overwrite previous project cameras');
 assert.deepEqual(errors,[]);
});
