import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('Sankey retains cycles, reciprocal flows and isolated folders through SVG export',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'codeflow-circular-'));
 const edges={a:['b','c'],b:['a'],c:['b'],isolated:[]};
 for(const [name,targets] of Object.entries(edges)){
  await mkdir(join(root,name));
  await writeFile(join(root,name,'index.js'),targets.map(n=>`import {${n}} from '../${n}/index.js';`).join('\n')+`\nexport function ${name}() { return `+(targets.length?targets.map(n=>n+'()').join('+'):'1')+'; }');
 }
 const app=createCodeflowServer({watchRoot:root,uiRoot:new URL('../',import.meta.url).pathname});let browser;
 t.after(async()=>{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port+'/?cli=1');
 const mode=page.getByRole('combobox',{name:'Visualization type'});await mode.selectOption('graph');
 await page.waitForFunction(()=>document.querySelectorAll('circle.nc').length===4);
 // Read the ordinary graph's bound analysis records to compare actual weights.
 const expected=await page.locator('svg path').evaluateAll(nodes=>nodes.map(n=>n.__data__).filter(d=>d?.source?.id&&d?.target?.id).map(d=>({source:d.source.id.split('/')[0],target:d.target.id.split('/')[0],value:d.count||1})));
 assert.equal(expected.length,4,'fixture exposes all four directional source relationships');
 await mode.selectOption('sankey');
 const scene=page.locator('.sankey-container');await scene.locator('.sankey-node').first().waitFor({timeout:5000});
 const observed=await scene.evaluate(el=>({nodes:[...el.querySelectorAll('.sankey-node')].map(n=>({folder:n.__data__.fullPath,height:n.__data__.y1-n.__data__.y0})),links:[...el.querySelectorAll('.sankey-link')].map(n=>({source:n.__data__.source.fullPath,target:n.__data__.target.fullPath,value:n.__data__.value,width:n.__data__.width,circular:n.__data__.circular,path:n.getAttribute('d')}))}));
 assert.deepEqual(observed.nodes.map(n=>n.folder).sort(),Object.keys(edges).sort());
 assert.deepEqual(observed.links.map(l=>l.source+'>'+l.target).sort(),['a>b','b>a','b>c','c>a']);
 assert.deepEqual(observed.links.map(({source,target,value})=>({source,target,value})).sort((a,b)=>(a.source+a.target).localeCompare(b.source+b.target)),expected.sort((a,b)=>(a.source+a.target).localeCompare(b.source+b.target)));
 assert.ok(observed.links.some(l=>l.circular));
 assert.ok(observed.nodes.every(n=>n.height>=0));
 assert.ok(observed.links.every(l=>l.width>=0&&l.value>0&&!/NaN|Infinity/.test(l.path)));
 await page.getByRole('button',{name:'Export analysis',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByText('SVG Image',{exact:true}).click()]);
 const xml=await readFile(await download.path(),'utf8');
 assert.equal((xml.match(/class="sankey-link"/g)||[]).length,4);
 for(const link of observed.links)assert.ok(xml.includes(link.path),'export retains circular and ordinary path geometry');
 assert.deepEqual(errors,[]);
});
