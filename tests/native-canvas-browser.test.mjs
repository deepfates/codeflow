import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('replacing a project releases the previous canvas pointer gesture',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000
},async t=>{
 const first=await mkdtemp(join(tmpdir(),'codeflow-canvas-first-'));
 const second=await mkdtemp(join(tmpdir(),'codeflow-canvas-second-'));
 await writeFile(join(first,'shared.js'),'export function first() { return 1; }');
 await writeFile(join(second,'shared.js'),'export function second() { return 2; }');
 const app=createCodeflowServer({watchRoot:first,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(first,{recursive:true,force:true});await rm(second,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 const view=page.getByRole('combobox',{name:'Visualization type'});
 await view.waitFor();await view.selectOption('code');
 const head=page.locator('[data-code-card="shared.js"] .code-card-head');
 await head.waitFor();await page.waitForTimeout(350);
 const box=await head.boundingBox();
 await page.mouse.move(box.x+60,box.y+15);await page.mouse.down();
 await page.locator('input[type="file"][webkitdirectory]').setInputFiles(second);
 await view.waitFor();
 await page.locator('[data-code-card="shared.js"]').waitFor({state:'detached'});
 const selection=page.getByRole('button',{name:'← Back to Issues',exact:true});
 assert.equal(await selection.count(),0);
 await page.mouse.up();
 await page.waitForTimeout(100);
 assert.equal(await selection.count(),0,'old pointerup cannot select a same-named file in the new project');
 assert.deepEqual(errors,[]);
});
