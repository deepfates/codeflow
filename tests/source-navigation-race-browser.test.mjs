import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

for(const method of ['references','definition'])test(method+' requested for A cannot change B after investigation changes',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-language-owner-'));
 await writeFile(join(root,'a.ex'),'defmodule A do\n def a, do: :ok\nend');
 await writeFile(join(root,'b.ex'),'defmodule B do\n def b, do: :ok\nend');
 const range={start:{line:1,character:5},end:{line:1,character:6}};
 const analysis={assessment:{status:'ready',findings:[]},session:{status:()=>({state:'ready',diagnostics:[]}),symbols:async path=>[{name:path[0]+'/0',range,selectionRange:range}],references:async()=>[{path:'a.ex',range}],definition:async()=>[{path:'a.ex',range}],dispose(){}}};
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname,analysis,beamGraph:{schemaVersion:1,status:'ready',nodes:[],edges:[],warnings:[]}});
 let browser,release;const held=new Promise(resolve=>release=resolve);
 t.after(async()=>{release();await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.env.CODEFLOW_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.waitForFunction(()=>document.querySelectorAll('circle.nc').length===2);
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-file').filter({hasText:'a.ex'}).click();
 await page.getByRole('button',{name:'a/0',exact:true}).waitFor();
 let started;const requested=new Promise(resolve=>started=resolve);
 await page.route('**/__codeflow/language?method='+method+'&**',async route=>{started();await held;await route.continue();});
 if(method==='references')await page.getByTitle('Find references',{exact:true}).click();
 else{await page.getByRole('button',{name:'a/0',exact:true}).click();await page.locator('[data-code-card="a.ex"] [data-line="2"].highlighted').waitFor();await page.waitForTimeout(400);const point=await page.locator('[data-code-card="a.ex"] [data-line="2"] .file-preview-text').evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.textContent.indexOf('a');if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);const box=range.getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2};}});assert.ok(point);await page.keyboard.down('Meta');await page.mouse.click(point.x,point.y);await page.keyboard.up('Meta');}
 await requested;
 await page.locator('.tree-file').filter({hasText:'b.ex'}).click();
 await page.getByRole('button',{name:'b/0',exact:true}).waitFor();
 const response=page.waitForResponse(r=>r.url().includes('method='+method));
 release();await response;await page.waitForTimeout(250);
 assert.ok(await page.locator('.panel-title').filter({hasText:'b.ex'}).count(),'old definition response cannot navigate away from B');
 assert.equal(await page.getByRole('button',{name:'a.ex:2',exact:true}).count(),0,'old reference results cannot attach to the new file inspector');
 // A fresh request in B still renders, so invalidation does not disable navigation.
 await page.getByTitle('Find references',{exact:true}).click();
 await page.getByRole('button',{name:'a.ex:2',exact:true}).waitFor();
 await page.getByRole('button',{name:'a.ex:2',exact:true}).click();
 await page.locator('[data-code-card="a.ex"] [data-line="2"].highlighted').waitFor();
 assert.deepEqual(errors,[]);
});
