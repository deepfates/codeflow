import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('SVG export downloads the active D3 view with its own geometry',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-view-export-'));
 for(const folder of ['lib','ui'])await mkdir(join(root,folder));
 await writeFile(join(root,'lib/provider.js'),'export function provide() { return 1; }');
 await writeFile(join(root,'ui/consumer.js'),"import {provide} from '../lib/provider.js'; provide();");
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 const mode=page.getByRole('combobox',{name:'Visualization type'});
 for(const [view,shape] of [['treemap','treemap-rect'],['matrix','matrix-cell-rect'],['dendro','dendro-node'],['sankey','sankey-node'],['disjoint','disjoint-node'],['bundle','bundle-circle']]){
  await mode.selectOption(view);
  await page.locator('.'+view+'-container .'+shape).first().waitFor();
  await page.getByRole('button',{name:'Export analysis',exact:true}).click();
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:5000}),page.getByText('SVG Image',{exact:true}).click()]);
  const xml=await readFile(await download.path(),'utf8');
  assert.match(xml,new RegExp(shape),view+' exports its own rendered geometry');
  assert.match(xml,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(xml,/--bg0:/,'export embeds the active theme');
 }
});
