import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeflowServer} from '../cli/codeflow.mjs';

test('selecting another folder cancels an older CLI load and keeps the newer graph', {
    skip: !process.env.CODEFLOW_TEST_BROWSER, timeout: 30000
}, async t => {
    const first = await mkdtemp(join(tmpdir(), 'codeflow-load-first-'));
    const second = await mkdtemp(join(tmpdir(), 'codeflow-load-second-'));
    await writeFile(join(first, 'first.js'), 'export function first() { return 1; }');
    await writeFile(join(second, 'second.js'), 'export function second() { return 2; }');
    const app = createCodeflowServer({watchRoot: first, uiRoot: new URL('../', import.meta.url).pathname});
    let browser, release;
    t.after(async () => {
        release?.();
        if (browser) await browser.close();
        await app.close();
        await rm(first, {recursive: true, force: true});
        await rm(second, {recursive: true, force: true});
    });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const {chromium} = await import('playwright');
    browser = await chromium.launch({headless: true, ...(process.env.CODEFLOW_BROWSER_CHANNEL ? {channel: process.env.CODEFLOW_BROWSER_CHANNEL} : {})});
    const page = await browser.newPage();
    let arrived;
    const held = new Promise(resolve => {release = resolve;});
    const started = new Promise(resolve => {arrived = resolve;});
    await page.route('**/__codeflow/file?path=first.js', async route => {
        arrived();await held;await route.continue().catch(() => {});
    });
    await page.goto('http://127.0.0.1:' + app.server.address().port + '/?cli=1');
    await started;
    const cancelled = page.waitForEvent('requestfailed', {predicate: request => request.url().includes('path=first.js'), timeout: 5000});
    await page.locator('input[type="file"][webkitdirectory]').setInputFiles(second);
    await cancelled;
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('circle.nc')].some(node => node.__data__?.id === 'second.js'));
    assert.deepEqual(await page.locator('circle.nc').evaluateAll(nodes => nodes.map(node => node.__data__.id)), ['second.js']);
});
