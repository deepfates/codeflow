import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSource} from '../src/project/access.mjs';
import {createGitHubAdapter} from '../src/project/github.mjs';

const cli = {ok: true, root: '/projects/one'};
const identity = {sourceType: 'cli', sourceKey: cli.root};

test('cached projects cannot read from another open checkout or retained folder', () => {
    assert.equal(createProjectSource({identity: {sourceType: 'github', sourceKey: 'owner/one'},
        github: {owner: 'owner', repo: 'two', client: {}}}), null);
    assert.equal(createProjectSource({identity, cli: {...cli, root: '/projects/two'}}), null);
    assert.equal(createProjectSource({identity: {sourceType: 'folder', sourceKey: 'one'},
        folder: {sourceKey: 'two', handle: {}}}), null);
    assert.equal(createProjectSource({identity: {sourceType: 'zip', sourceKey: 'one'},
        archive: {sourceKey: 'two', entriesByPath: {}}}), null);
});

test('source reads distinguish empty files, missing files and unavailable connections', async () => {
    let mode = 'empty';
    const source = createProjectSource({identity, cli, fetch: async () => {
        if (mode === 'failure') throw new Error('Disconnected');
        return {ok: mode === 'empty', status: mode === 'empty' ? 200 : 404, text: async () => ''};
    }});
    assert.deepEqual(await source.read('lib/empty.ex'), {status: 'ready', content: ''});
    mode = 'missing';assert.deepEqual(await source.read('lib/empty.ex'), {status: 'missing'});
    mode = 'failure';assert.deepEqual(await source.read('lib/empty.ex'), {status: 'unavailable', reason: 'Disconnected'});
});

test('folder and archive adapters read the same project-relative path', async () => {
    const content = 'defmodule Example do\nend';
    const folder = createProjectSource({identity: {sourceType: 'folder', sourceKey: 'selected'}, folder: {
        sourceKey: 'selected', handle: {async getDirectoryHandle(name) {
            assert.equal(name, 'lib');
            return {async getFileHandle(name) {assert.equal(name, 'example.ex');return {getFile: async () => ({text: async () => content})};}};
        }}
    }});
    const archive = createProjectSource({identity: {sourceType: 'zip', sourceKey: 'archive'}, archive: {
        sourceKey: 'archive', entriesByPath: {'lib/example.ex': {async: async format => {assert.equal(format, 'string');return content;}}}
    }});
    assert.deepEqual(await folder.read('lib/example.ex'), {status: 'ready', content});
    assert.deepEqual(await archive.read('lib/example.ex'), {status: 'ready', content});
    assert.deepEqual(await archive.read('missing.ex'), {status: 'missing'});
});

test('source cancellation reaches HTTP and rejects a late response', async () => {
    let resolve, requestedSignal;
    const source = createProjectSource({identity, cli, fetch: (url, {signal}) => {
        requestedSignal = signal;
        return new Promise(done => {resolve = done;});
    }});
    const controller = new AbortController();
    const result = source.read('lib/example.ex', {signal: controller.signal});
    controller.abort();
    resolve({ok: true, text: async () => 'stale'});
    await assert.rejects(result, {name: 'AbortError'});
    assert.equal(requestedSignal, controller.signal);
});

test('GitHub empty files remain readable and an absent API result is not claimed to prove deletion', async () => {
    const client = createGitHubAdapter();
    client.fetch = async () => ({content: ''});
    const source = createProjectSource({identity: {sourceType: 'github', sourceKey: 'owner/repo'},
        github: {owner: 'owner', repo: 'repo', client}});
    assert.deepEqual(await source.read('empty.js'), {status: 'ready', content: ''});
    client.fetch = async () => {throw new Error('Rate limited');};
    assert.equal((await source.read('empty.js')).status, 'unavailable');
});
