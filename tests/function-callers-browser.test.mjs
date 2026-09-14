import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('function inspection exposes callers beyond eight and navigates to their actual source',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-function-callers-'));
 await writeFile(join(root,'provider.js'),'export function shared() { return 42; }');
 for(let i=1;i<=11;i++)await writeFile(join(root,'caller'+String(i).padStart(2,'0')+'.js'),"import {shared} from './provider.js';\nexport function caller"+i+'() { return shared(); }');
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.getByRole('combobox',{name:'Visualization type'}).selectOption('graph');
 await page.waitForFunction(()=>document.querySelectorAll('circle.nc').length===12);
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-file').filter({hasText:'provider.js'}).click();
 await page.locator('.fn-header').filter({hasText:'shared()'}).click();
 assert.equal(await page.locator('.fn-caller').count(),11,'every retained caller has a navigable entry');
 const ninth=page.locator('.fn-caller').filter({hasText:'caller09.js'});
 await ninth.scrollIntoViewIfNeeded();
 assert.ok(await page.locator('.panel-content').evaluate(el=>el.scrollTop>0),'the existing inspector scroll exposes later caller rows');
 await ninth.click();
 await page.locator('.panel-title').filter({hasText:'caller09.js'}).waitFor();
 await page.getByRole('button',{name:'View Source',exact:true}).click();
 await page.locator('.file-preview-code').waitFor();
 assert.match(await page.locator('.file-preview-code').innerText(),/export function caller9\(\) \{ return shared\(\); \}/);
 assert.deepEqual(errors,[]);
});
