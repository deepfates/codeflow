import test from 'node:test';
import assert from 'node:assert/strict';

test('PR assessment shows factual review areas and opens matching tests from analyzed GitHub source',{
 skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
},async t=>{
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true,channel:process.env.CODEFLOW_BROWSER_CHANNEL||'chrome'});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
 const files={
  'src/lib-extra/change.js':'export function changed() { return 42; }',
  'src/lib/ignored.js':'export function unrelated() { return 7; }',
  'test/change.test.js':"import {changed} from '../src/lib-extra/change.js';\nexport function check() { return changed(); }",
 };
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://api.github.com/**',async route=>{
  const url=new URL(route.request().url());let body;
  if(url.pathname==='/rate_limit')body={resources:{core:{remaining:5000,limit:5000,reset:0}}};
  else if(url.pathname==='/repos/example/project')body={default_branch:'main'};
  else if(url.searchParams.has('recursive'))body={sha:'root-tree',tree:Object.keys(files).map(path=>({path,type:'blob',size:100})),truncated:false};
  else if(url.pathname.includes('/contents/'))body={content:Buffer.from(files[decodeURIComponent(url.pathname.split('/contents/')[1])]).toString('base64')};
  else if(url.pathname.endsWith('/commits'))body=[];
  else if(url.pathname.endsWith('/pulls/1/files'))body=[{filename:'src/lib-extra/change.js',status:'modified',additions:600,deletions:0}];
  else if(url.pathname.endsWith('/pulls/1'))body={title:'Change implementation',additions:600,deletions:0};
  else throw Error('Unexpected request '+url);
  await route.fulfill({json:body});
 });
 await page.goto(new URL('../index.html',import.meta.url).href);
 await page.getByRole('textbox',{name:'Repository URL',exact:true}).fill('example/project');
 await page.locator('#analyze-btn').click();
 await page.getByRole('combobox',{name:'Visualization type'}).waitFor();
 await page.getByRole('button',{name:'Analyze Pull Request',exact:true}).click();
 await page.getByRole('textbox',{name:'Pull Request URL',exact:true}).fill('https://github.com/example/project/pull/1');
 await page.locator('.pr-modal').getByRole('button',{name:'Analyze Pull Request',exact:true}).click();
 await page.locator('.pr-title').filter({hasText:'Change implementation'}).waitFor();
 assert.equal(await page.locator('.pr-risk-value').innerText(),'25');
 assert.match(await page.locator('.pr-modal').innerText(),/Large changeset \(600 lines\)/);
 const area=page.locator('.pr-impact-card').filter({has:page.getByText('Review areas',{exact:true})});
 await area.waitFor();
 assert.deepEqual(await area.locator('.pr-reviewer-reason').allTextContents(),['1 file in affected folders'],'similarly prefixed sibling folder is excluded');
 assert.doesNotMatch(await area.innerText(),/Expert|Knows|Suggested Reviewers/);
 await page.getByRole('button',{name:'change.test.js',exact:true}).click();
 assert.equal(await page.locator('.pr-modal').count(),0);
 await page.locator('.panel-title').filter({hasText:'change.test.js'}).waitFor();
 await page.getByRole('button',{name:'View Source',exact:true}).click();
 assert.match(await page.locator('.file-preview-code').innerText(),/export function check\(\)/);
 assert.deepEqual(errors,[]);
});
