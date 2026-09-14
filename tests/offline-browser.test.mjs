import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNodeAnalyzer} from '../src/node/analysis.mjs';
const require=createRequire(import.meta.url);

test('offline ZIP and selected-folder imports share grammar evidence and exact source navigation',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000
},async t=>{
 const {chromium}=await import('playwright');
 const JSZip=require('../vendor/jszip/jszip.min.js');
 const zip=new JSZip();
 const content='defmodule Example do\n  def run(), do: :ok\nend';
 zip.file('lib/example.ex',content);
 zip.file('deps/vendor/lib/excluded.ex','defmodule Vendored do\nend');
 const browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[],network=[];let workers=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('worker',()=>workers++);
 await page.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
 await page.goto(new URL('../index.html',import.meta.url).href);
 await page.locator('input[type="file"][accept]').setInputFiles({name:'example.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor({timeout:45000});
 await page.getByRole('button',{name:'Export analysis',exact:true}).click();
 const downloaded=page.waitForEvent('download');
 await page.getByText('Raw JSON',{exact:true}).click();
 const download=await downloaded;
 const exported=JSON.parse(await readFile(await download.path(),'utf8'));
 const data=exported.data||exported;
 const {analyzeFiles}=createNodeAnalyzer();
 const expected=await analyzeFiles({files:[{path:'lib/example.ex',name:'example.ex',folder:'lib',content,functions:[],isCode:true,lines:3,layer:'utils'}]});
 assert.equal(data.files.length,1,'default dependency exclusions apply to ZIPs');
 assert.equal(data.files[0].elixir.status,'ready');
 assert.deepEqual(data.files[0].elixir,expected.files[0].elixir);
 assert.ok(workers>0,'ordinary offline analysis actually uses its built worker');
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 const search=page.getByRole('searchbox',{name:'Find files and symbols'});
 await search.fill('Example.run/0');await search.press('Enter');
 await page.locator('[data-code-card="lib/example.ex"] [data-line="2"].highlighted').waitFor();
 // The browser's directory-file input is a distinct acquisition path from ZIP.
 const folder=await mkdtemp(join(tmpdir(),'codeflow-selected-folder-'));
 t.after(()=>rm(folder,{recursive:true,force:true}));
 await mkdir(join(folder,'lib'));await mkdir(join(folder,'deps'));
 await writeFile(join(folder,'lib/example.ex'),content);
 await writeFile(join(folder,'deps/excluded.ex'),'defmodule Vendored do\nend');
 await page.locator('input[type="file"][webkitdirectory]').setInputFiles(folder);
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor({timeout:45000});
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await search.fill('Example.run/0');await search.press('Enter');
 await page.locator('[data-code-card="lib/example.ex"] [data-line="2"].highlighted').waitFor();
 assert.deepEqual(errors,[]);
 assert.deepEqual(network,[],'offline source analysis must not require network requests');
});
