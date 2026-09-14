import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeCliAnalysis} from '../src/project/cli-analysis.mjs';

const snapshot = {
    language: {state: 'ready', diagnostics: [{path: 'lib/example.ex', message: 'Unused variable'}]},
    assessment: {status: 'ready', findings: []}, graphRevision: 'build-1'
};
const graph = {status: 'ready', nodes: [{path: 'lib/example.ex'}], edges: []};
const response = value => ({ok: true, json: async () => value});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('each project subscription delivers unchanged diagnostics and compiler dependencies to its own model', async () => {
    for (let run = 0; run < 2; run++) {
        const updates = [], signals = [];
        const dispose = subscribeCliAnalysis({interval: 60000,
            fetch: async (path, {signal}) => {
                signals.push(signal);
                return response(path.endsWith('/beam') ? graph : snapshot);
            }, onUpdate: update => updates.push(update)});
        try {
            await tick();
            assert.equal(updates[0].diagnostics[0].findings[0].message, 'Unused variable');
            assert.deepEqual(updates[1].graph, graph);
        } finally {dispose();}
        assert.ok(signals.every(signal => signal.aborted), 'disposal cancels owned requests');
    }
});

test('disposed tool connections cannot publish even when a transport ignores cancellation', async () => {
    let resolve;
    const updates = [];
    const dispose = subscribeCliAnalysis({fetch: () => new Promise(done => {resolve = done;}),
        onUpdate: update => updates.push(update)});
    dispose();
    resolve(response(snapshot));
    await tick();
    assert.deepEqual(updates, []);
});

test('a lost connection preserves recorded findings and reports unavailable tools; recovery refreshes it', {timeout: 2000}, async t => {
    const updates = [];
    let reads = 0;
    let recovered;
    const recovery = new Promise(resolve => {recovered = resolve;});
    const dispose = subscribeCliAnalysis({interval: 1,
        fetch: async path => {
            if (path.endsWith('/beam')) return response(graph);
            if (++reads === 2) throw new Error('Connection lost');
            return response(snapshot);
        }, onUpdate: update => {
            updates.push(update);
            if (reads >= 3 && update.diagnostics) recovered();
        }});
    t.after(dispose);
    await recovery;
    const unavailable = updates.find(update => update.analysis?.language.state === 'unavailable');
    assert.equal(unavailable.diagnostics[0].reason, 'Connection lost');
    assert.deepEqual(unavailable.diagnostics[0].findings, snapshot.language.diagnostics);
    assert.equal(updates.at(-1).diagnostics[0].status, 'ready');
    assert.equal(updates.filter(update => update.graph).length, 1, 'unchanged compiler dependencies are not repeatedly reapplied');
});

test('a compiler graph refresh failure does not label working language tools unavailable', async () => {
    const updates = [];
    const dispose = subscribeCliAnalysis({interval: 60000,
        fetch: async path => path.endsWith('/beam') ? {ok: false, status: 503} : response(snapshot),
        onUpdate: update => updates.push(update)});
    try {
        await tick();
        assert.equal(updates[0].analysis.language.state, 'ready');
        assert.equal(updates[0].diagnostics[0].status, 'ready');
        assert.deepEqual(updates[1].diagnostics.map(tool => [tool.id, tool.status]), [['mix', 'unavailable']]);
        assert.equal(updates[1].graph, undefined, 'failed refresh retains the last graph');
    } finally {dispose();}
});
