import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('existing report controls download complete JSON, Markdown and text for a large project',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-reports-'));
 for(let i=0;i<105;i++){
  await mkdir(join(root,`lib/part_${i}`),{recursive:true});
  await writeFile(join(root,`lib/part_${i}/same.js`),(i?`import { fn${i-1} } from '../part_${i-1}/same.js';\n`:'')+`export function fn${i}() { return ${i?'fn'+(i-1)+'()':'0'}; }\n`);
 }
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});
 let browser;
 t.after(async()=>{if(browser)await browser.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor();
 for(const [label,format] of [['JSON Report','json'],['Markdown','md'],['Plain Text','txt']])await t.test(label,async()=>{
  await page.getByRole('button',{name:'Export analysis',exact:true}).click();
  const pending=page.waitForEvent('download');
  await page.locator('.export-option').filter({has:page.getByText(label,{exact:true})}).click();
  const download=await pending;
  assert.equal(download.suggestedFilename(),'codeflow-report.'+format);
  const content=await readFile(await download.path(),'utf8');
  if(format==='json'){
   const report=JSON.parse(content);
   assert.equal(report.files.length,105);
   assert.equal(report.dependencies.length,104);
  }else if(format==='md'){
   assert.ok(content.includes('| `lib/part_104/same.js` |'),'Markdown file section includes the final full path beyond100files');
   assert.ok(content.includes('lib/part_103/same.js -> lib/part_104/same.js'));
  }else{
   assert.ok(content.includes('lib/part_103/same.js -> lib/part_104/same.js'),'text retains final dependency beyond100edges with full paths');
  }
 });
 assert.deepEqual(errors,[]);
});
