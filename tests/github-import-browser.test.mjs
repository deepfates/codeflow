import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('GitHub imports every eligible file beyond the former sample cap and preserves failed reads', {
    skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 90000
}, async t => {
    const {chromium}=await import('playwright');
    const browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
    t.after(()=>browser.close());
    const page=await browser.newPage({viewport:{width:1400,height:1000}});
    const paths=Array.from({length:751},(_,i)=>`notes/n${String(i).padStart(3,'0')}.md`);
    paths.push('missing.md','empty.md');
    const reads=new Set(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://api.github.com/**',async route=>{
        const url=new URL(route.request().url());
        let body;
        if(url.pathname==='/rate_limit')body={resources:{core:{remaining:5000,limit:5000,reset:0}}};
        else if(url.pathname==='/repos/example/project')body={default_branch:'main'};
        else if(url.pathname.includes('/git/trees/'))body={tree:paths.map(path=>({path,type:'blob',size:20})),truncated:false};
        else if(url.pathname.includes('/contents/')){
            const path=decodeURIComponent(url.pathname.split('/contents/')[1]);reads.add(path);
            if(path==='missing.md')return route.fulfill({status:503,json:{message:'unavailable'}});
            body={content:Buffer.from(path==='empty.md'?'':`# ${path}`).toString('base64')};
        }else if(url.pathname.endsWith('/commits'))body=[];
        else throw new Error('Unexpected GitHub request: '+url.href);
        await route.fulfill({json:body});
    });
    await page.goto(new URL('../index.html',import.meta.url).href);
    await page.getByRole('textbox',{name:'Repository URL',exact:true}).fill('example/project');
    await page.locator('#analyze-btn').click();
    await page.getByRole('button',{name:'Analyze repository',exact:true}).filter({hasNot:page.locator('svg')}).click();
    await page.getByRole('combobox',{name:'Visualization type'}).waitFor({timeout:60000});
    assert.equal(reads.size,paths.length,'all listed files were requested');
    await page.getByRole('button',{name:'Export analysis',exact:true}).click();
    const downloading=page.waitForEvent('download');
    await page.getByText('Raw JSON',{exact:true}).click();
    const download=await downloading;
    const exported=JSON.parse(await readFile(await download.path(),'utf8'));
    const data=exported.data||exported;
    assert.deepEqual(data.files.map(file=>file.path).sort(),paths.slice().sort());
    assert.equal(data.files.find(file=>file.path==='missing.md').analysisSkipped,'fetch-failed');
    assert.equal(data.files.find(file=>file.path==='empty.md').content,'');
    assert.deepEqual(errors,[]);
});

test('selecting a folder aborts the pending GitHub source request',{
    skip:!process.env.CODEFLOW_TEST_BROWSER,timeout:30000
},async t=>{
    const {chromium}=await import('playwright');
    const browser=await chromium.launch({headless:true,...(process.env.CODEFLOW_BROWSER_CHANNEL?{channel:process.env.CODEFLOW_BROWSER_CHANNEL}:{})});
    const folder=await mkdtemp(join(tmpdir(),'codeflow-github-cancel-'));
    await writeFile(join(folder,'new.js'),'export function replacement() { return 1; }');
    let release,arrived;
    const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{arrived=resolve;});
    t.after(async()=>{release();await browser.close();await rm(folder,{recursive:true,force:true});});
    const page=await browser.newPage({viewport:{width:1400,height:1000}});
    await page.route('https://api.github.com/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        let body;
        if(path==='/rate_limit')body={resources:{core:{remaining:5000,limit:5000,reset:0}}};
        else if(path==='/repos/example/project')body={default_branch:'main'};
        else if(path.includes('/git/trees/'))body={tree:[{path:'old.md',type:'blob',size:20}],truncated:false};
        else if(path.endsWith('/contents/old.md')){
            arrived();await held;
            return route.fulfill({json:{content:Buffer.from('# Obsolete').toString('base64')}}).catch(()=>{});
        }else throw Error('Unexpected request: '+path);
        await route.fulfill({json:body});
    });
    await page.goto(new URL('../index.html',import.meta.url).href);
    await page.getByRole('textbox',{name:'Repository URL',exact:true}).fill('example/project');
    await page.locator('#analyze-btn').click();await started;
    const cancelled=page.waitForEvent('requestfailed',{predicate:request=>request.url().endsWith('/contents/old.md'),timeout:5000});
    await page.locator('input[type="file"][webkitdirectory]').setInputFiles(folder);
    await cancelled;release();
    await page.waitForFunction(()=>[...document.querySelectorAll('circle.nc')].some(node=>node.__data__?.id==='new.js'));
    assert.deepEqual(await page.locator('circle.nc').evaluateAll(nodes=>nodes.map(node=>node.__data__.id)),['new.js']);
});
