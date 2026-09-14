import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalTools} from '../src/project/local-tools.mjs';
const status = {ok: true, root: '/one'};
const identity = {sourceType: 'cli', sourceKey: '/one'};

test('language and runtime tools require the matching CLI checkout', () => {
    assert.equal(createLocalTools({identity: {...identity, sourceKey: '/two'}, status}), null);
    assert.equal(createLocalTools({identity: {sourceType: 'zip', sourceKey: '/one'}, status}), null);
});

test('switching projects aborts language and runtime requests and rejects their late results', async () => {
    const pending = [];
    const tools = createLocalTools({identity, status, fetch: (url, {signal}) => new Promise(resolve => pending.push({url, signal, resolve}))});
    const language = tools.language('definition', 'lib/worker.ex', {line: 2, character: 4});
    const runtime = tools.runtime('app@host');
    tools.dispose();
    for (const request of pending) {
        assert.equal(request.signal.aborted, true);
        request.resolve({ok: true, json: async () => ({stale: true})});
    }
    await assert.rejects(language, {name: 'AbortError'});
    await assert.rejects(runtime, {name: 'AbortError'});
    await assert.rejects(tools.runtime('app@host'), {name: 'AbortError'});
});

test('new navigation supersedes an older request without cancelling the outline', async () => {
    const pending = [];
    const tools = createLocalTools({identity, status, fetch: (url, {signal}) => new Promise(resolve => pending.push({signal, resolve}))});
    const old = tools.language('definition', 'one.ex');
    const outline = tools.language('symbols', 'two.ex');
    const current = tools.language('references', 'two.ex');
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(pending[1].signal.aborted, false);
    pending.forEach((request, index) => request.resolve({ok: true, json: async () => [index]}));
    await assert.rejects(old, {name: 'AbortError'});
    assert.deepEqual(await outline, [1]);assert.deepEqual(await current, [2]);
    tools.dispose();
});
