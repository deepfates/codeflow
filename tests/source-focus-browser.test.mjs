import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('symbol navigation reveals the requested line inside a long source card at non-unit zoom', {
  skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:60000,
}, async t => {
  const root=await mkdtemp(join(tmpdir(),'codeflow-source-focus-'));
  const lines=Array.from({length:650},(_,i)=>'// source line '+(i+1));
  lines[0]='export function start() { return 0; }';
  lines[359]='export function targetBelow() { return 360; }';
  lines[119]='export function targetAbove() { return 120; }';
  await writeFile(join(root,'long.js'),lines.join('\n'));
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
  await page.getByRole('combobox',{name:'Visualization type'}).selectOption('code');
  const card=page.locator('[data-code-card="long.js"]');
  await card.waitFor();
  await page.getByRole('tab',{name:'Files',exact:true}).click();
  const search=page.getByRole('searchbox',{name:'Find files and symbols'});
  for(const [zoom,symbol,line] of [['Zoom out','targetBelow',360],['Zoom in','targetAbove',120]]){
    await page.getByRole('button',{name:zoom,exact:true}).click();
    await page.waitForTimeout(500); // The native toolbar animates the camera for 200 ms.
    const scale=await card.evaluate(el=>el.getBoundingClientRect().height/el.offsetHeight);
    assert.ok(Math.abs(scale-1)>0.05,'regression requires transformed source coordinates');
    await search.fill(symbol);await search.press('Enter');
    await card.locator('[data-line="'+line+'"].highlighted').waitFor();
    await page.waitForTimeout(600); // Let the normal card camera transition finish.
    const bounds=await card.evaluate((el,line)=>{
      const body=el.querySelector('.code-card-body');
      const source=el.querySelector('[data-line="'+line+'"]');
      const b=body.getBoundingClientRect(),r=source.getBoundingClientRect();
      return {bodyTop:b.top,bodyBottom:b.bottom,lineTop:r.top,lineBottom:r.bottom,scrollTop:body.scrollTop};
    },line);
    assert.ok(bounds.lineTop>=bounds.bodyTop&&bounds.lineBottom<=bounds.bodyBottom,
      'requested line must be visible inside its scroll container: '+JSON.stringify(bounds));
  }
  assert.deepEqual(errors,[]);
});
