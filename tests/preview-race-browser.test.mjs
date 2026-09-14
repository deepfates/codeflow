import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

for(const scenario of ['newer preview','closed preview'])test('a held source read cannot replace a '+scenario,{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-preview-owner-'));
 await writeFile(join(root,'a.js'),'export function a() { return "source A"; }');
 await writeFile(join(root,'b.js'),'export function b() { return "source B"; }');
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser,release;const held=new Promise(resolve=>{release=resolve;});
 t.after(async()=>{release();await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.env.CODEFLOW_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor();
 await page.getByRole('tab',{name:'Recents',exact:true}).click();await page.locator('.recent-item').waitFor();
 // Older saved analyses may not contain source. Keep the genuine analysis and
 // source identity, removing only cached source to exercise its ordinary reader.
 await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('codeflow-recents');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('analyses','readwrite'),store=tx.objectStore('analyses'),get=store.getAll();get.onsuccess=()=>{for(const record of get.result){for(const file of record.data.files)delete file.content;store.put(record);}};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
 await page.locator('.recent-item').click();
 let requested,completed;const started=new Promise(resolve=>requested=resolve),finished=new Promise(resolve=>completed=resolve);let reads=0;
 await page.route('**/__codeflow/file?path=a.js',async route=>{reads++;requested();await held;await route.continue();completed();});
 async function preview(path){await page.getByRole('tab',{name:'Files',exact:true}).click();await page.locator('.tree-file').filter({hasText:path}).click();await page.getByRole('button',{name:'View Source',exact:true}).click();}
 await preview('a.js');await started;
 await page.locator('.file-preview-loading').waitFor();
 await page.locator('.file-preview-close').click();
 if(scenario==='newer preview'){await preview('b.js');await page.locator('.file-preview-code').waitFor();}
 const response=page.waitForResponse(r=>r.url().endsWith('/__codeflow/file?path=a.js'));
 release();await finished;await response;await page.waitForTimeout(250);
 if(scenario==='newer preview'){
   assert.equal(await page.locator('.file-preview-name').innerText(),'b.js');
   assert.match(await page.locator('.file-preview-code').innerText(),/source B/);
   await page.locator('.file-preview-close').click();
 }else assert.equal(await page.locator('.file-preview-modal').count(),0,'finished read cannot reopen a closed modal');
 // Invalidating presentation must not discard a successful project source read.
 await preview('a.js');await page.locator('.file-preview-code').waitFor();
 assert.match(await page.locator('.file-preview-code').innerText(),/source A/);
 assert.equal(reads,1,'reopening uses the successfully hydrated source');
 assert.deepEqual(errors,[]);
});
