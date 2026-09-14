import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('Issues and Security source links share exact source navigation and history while preserving View previews',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-issue-source-'));
 const lines=Array.from({length:100},(_,i)=>'// line '+(i+1));
 lines[59]='function unusedOperation(input) {';
 lines[74]='  return eval(input);';lines[75]='}';
 await writeFile(join(root,'target.js'),lines.join('\n'));
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,channel:process.env.CODEFLOW_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 const view=page.getByRole('combobox',{name:'Visualization type'});await view.waitFor();
 await page.locator('.security-item').filter({hasText:'Unused Functions'}).click();
 await page.locator('.modal').getByRole('button',{name:'View',exact:true}).click();
 await page.locator('.file-preview-line.highlighted').waitFor();
 assert.match(await page.locator('.file-preview-line.highlighted').innerText(),/60.*unusedOperation/s);
 assert.equal(await view.inputValue(),'graph','View retains the preview without changing visualization');
 await page.locator('.file-preview-close').click();
 await page.locator('.modal').getByRole('button',{name:'Go to file →',exact:true}).click();
 const sourceLine=n=>page.locator('[data-code-card="target.js"] [data-line="'+n+'"].highlighted');
 async function visibleLine(n){await sourceLine(n).waitFor();await page.waitForTimeout(650);assert.equal(await sourceLine(n).evaluate(el=>{const r=el.getBoundingClientRect(),b=el.closest('.code-card-body').getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom;}),true,'source line '+n+' is visible');}
 await visibleLine(60);assert.equal(await view.inputValue(),'code');
 await page.getByRole('button',{name:'← Back to Issues',exact:true}).click();
 await page.locator('.panel-tab').filter({hasText:'SECURITY'}).click();
 await page.locator('.security-item').filter({hasText:'Dynamic Code Execution'}).click();
 await page.locator('.modal').getByText('target.js',{exact:true}).first().click();
 await visibleLine(75);
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await visibleLine(60);
 await page.getByRole('button',{name:'Forward',exact:true}).click();
 await visibleLine(75);
 assert.deepEqual(errors,[]);
});
