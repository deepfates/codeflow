import test from 'node:test';
import assert from 'node:assert/strict';

test('file inspection keeps ownership tied to the selected file and preserves independent disclosures',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:45000,
},async t=>{
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
 let release,arrive;
 const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>arrive=resolve);
 t.after(async()=>{release();await browser.close();});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://api.github.com/**',async route=>{
  const url=new URL(route.request().url());let body;
  if(url.pathname==='/rate_limit')body={resources:{core:{remaining:5000,limit:5000,reset:0}}};
  else if(url.pathname==='/repos/example/project')body={default_branch:'main'};
  else if(url.pathname.includes('/git/trees/'))body={tree:['a.js','b.js'].map(path=>({path,type:'blob',size:50})),truncated:false};
  else if(url.pathname.includes('/contents/'))body={content:Buffer.from('export function hello(){return 1;}').toString('base64')};
  else if(url.pathname.endsWith('/commits')){
   if(url.searchParams.get('per_page')==='50'){
    const path=url.searchParams.get('path');
    if(path==='a.js'){arrive();await held;}
    body=[{commit:{author:{name:path==='a.js'?'Alice':'Bob'}}}];
   }else body=[];
  }else throw Error('Unexpected request '+url.href);
  await route.fulfill({json:body});
 });
 await page.goto(new URL('../index.html',import.meta.url).href);
 await page.getByRole('textbox',{name:'Repository URL',exact:true}).fill('example/project');
 await page.locator('#analyze-btn').click();
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor();
 await page.getByRole('tab',{name:'Files',exact:true}).click();
 await page.locator('.tree-file').filter({hasText:'a.js'}).click();await started;
 await page.locator('.card-header').filter({hasText:'Ownership'}).click();
 await page.locator('.tree-file').filter({hasText:'b.js'}).click();
 await page.locator('.owner-name').filter({hasText:'Bob'}).waitFor();
 release();
 await page.waitForResponse(response=>response.url().includes('per_page=50')&&response.url().includes('path=a.js'));
 await page.waitForTimeout(100);
 assert.deepEqual(await page.locator('.owner-name').allTextContents(),['Bob']);
 await page.locator('.fn-header').filter({hasText:'hello()'}).click();
 await page.locator('.fn-code').waitFor();
 await page.getByRole('button',{name:'View Source',exact:true}).click();
 assert.match(await page.locator('.file-preview-code').innerText(),/function hello/);
 assert.deepEqual(errors,[]);
});
