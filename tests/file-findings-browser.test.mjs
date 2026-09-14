import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('file findings explain a grouped assessment once and name every navigable symbol',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-file-findings-'));
 await writeFile(join(root,'sample.ex'),'defmodule Sample do\n  def first(), do: :one\n  def second(), do: :two\nend\n');
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.getByRole('combobox',{name:'Visualization type'}).selectOption('graph');
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-file').filter({hasText:'sample.ex'}).click();
 const findings=page.getByLabel('File findings',{exact:true});
 await findings.waitFor();
 const description='Source analysis found no callers. Elixir callbacks, macros and dynamic dispatch may invoke these functions; this is not evidence that they are unused.';
 assert.equal(await findings.getByText(description,{exact:true}).count(),1,'shared explanation appears once, retaining uncertainty');
 for(const [name,line] of [['first',2],['second',3]]){
  await findings.getByRole('button',{name:new RegExp('Sample\\.'+name+'/0')}).click();
  const source=page.locator('[data-code-card="sample.ex"] [data-line="'+line+'"].highlighted');
  await source.waitFor();
  assert.match(await source.innerText(),new RegExp('def '+name));
 }
});
