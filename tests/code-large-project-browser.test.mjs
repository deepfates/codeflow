import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('large root inventories enter Code immediately and open explicitly selected source', {
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-large-root-'));
 await Promise.all(Array.from({length:60},(_,i)=>writeFile(join(root,`file${i}.js`),`export function file${i}() { return ${i}; }\n`)));
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
 const selector=page.getByRole('combobox',{name:'Visualization type'});
 await selector.waitFor();
 await selector.selectOption('code');
 await page.locator('[data-code-card]').first().waitFor();
 assert.equal(await page.locator('[data-code-card]').count(),1,'open a useful initial source card without opening the entire inventory');
 const initial=await page.locator('[data-code-card]').first().getAttribute('data-code-card');
 const target=initial==='file59.js'?'file58.js':'file59.js';
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-file').filter({hasText:target}).click();
 await page.locator(`[data-code-card="${target}"]`).waitFor();
 assert.equal(await page.locator(`[data-code-card="${initial}"]`).count(),1,'explicit navigation retains the initial card');
 assert.equal(await page.locator('.tree-file').count(),60,'the full inventory remains navigable');
 assert.deepEqual(errors,[]);
});
