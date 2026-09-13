import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { translateXref } from '../cli/beam.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const context = { console };
vm.createContext(context);
for (const [start, end] of [
  ['// ===== CODEFLOW_ANALYZER_START =====', '// ===== CODEFLOW_ANALYZER_END ====='],
  ['function calcBlast(', 'function clampLineThickness('],
  ['// ===== CODEFLOW_CANVAS_START =====', '// ===== CODEFLOW_CANVAS_END ====='],
]) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing native helper boundary ${start}`);
  vm.runInContext(html.slice(from, to), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const snapshot = translateXref({
  'lib/caller.ex': {
    'lib/macro.ex': 'compile',
    'lib/data.ex': 'export',
    'lib/service.ex': 'runtime',
  },
  'lib/second.ex': { 'lib/service.ex': 'runtime' },
  'lib/isolated.ex': {},
  'lib/deleted.ex': { 'lib/service.ex': 'runtime' },
}, '/project');
snapshot.producer.freshness = 'unverified';

function analyzedFiles() {
  return snapshot.nodes.filter(node => node.id !== 'lib/deleted.ex').map(node => ({
    path: node.id, name: node.label, folder: node.group,
    content: `defmodule Example do\n  def pretend, do: :ok\nend`,
    functions: [{ name: 'pretend', file: node.id, line: 2 }],
    lines: 3, layer: 'utils', isCode: true, churn: 0,
  })).concat({ path: 'test/caller_test.exs', name: 'caller_test.exs', folder: 'test',
    content: 'defmodule ExampleTest do\nend', functions: [], lines: 2, layer: 'test', isCode: true });
}

test('compiler edges use native provider-to-consumer direction for impact and Code navigation', () => {
  const data = context.buildBeamAnalysisData({ analyzed: analyzedFiles(), snapshot, excludePatterns: [] });
  assert.equal(data.connections.length, 4);
  assert.deepEqual(plain(data.connections.map(c => [c.source, c.target, c.kind]).sort()), [
    ['lib/data.ex', 'lib/caller.ex', 'export'],
    ['lib/macro.ex', 'lib/caller.ex', 'compile'],
    ['lib/service.ex', 'lib/caller.ex', 'runtime'],
    ['lib/service.ex', 'lib/second.ex', 'runtime'],
  ]);
  assert.ok(data.connections.every(c => c.evidence === 'mix xref' && c.fn === null && c.count === 1));
  const serviceImpact = context.calcBlast('lib/service.ex', data.connections, data.files);
  assert.deepEqual(plain(serviceImpact.affected).sort(), ['lib/caller.ex', 'lib/second.ex']);
  assert.deepEqual(plain(serviceImpact.dependencies), []);
  const callerImpact = context.calcBlast('lib/caller.ex', data.connections, data.files);
  assert.deepEqual(plain(callerImpact.dependencies).sort(), ['lib/data.ex', 'lib/macro.ex', 'lib/service.ex']);
  assert.deepEqual(plain(context.getConnectedFilePaths('lib/caller.ex', data.connections)).sort(),
    ['lib/data.ex', 'lib/macro.ex', 'lib/service.ex']);
});

test('compiler scope retains source and isolated files without inventing symbol or quality evidence', () => {
  const input = analyzedFiles();
  const data = context.buildBeamAnalysisData({ analyzed: input, snapshot, excludePatterns: [] });
  assert.equal(data.files.length, 6);
  assert.ok(data.files.some(file => file.path === 'lib/isolated.ex'));
  assert.ok(data.files.every(file => file.path !== 'test/caller_test.exs' && file.path !== 'lib/deleted.ex'));
  assert.ok(data.files.every(file => file.content === input.find(source => source.path === file.path).content));
  assert.ok(data.files.every(file => file.functions.length === 0));
  for (const name of ['functions', 'deadFunctions', 'issues', 'securityIssues']) assert.deepEqual(plain(data[name]), []);
  assert.deepEqual(plain(data.fnStats), {});
  assert.deepEqual(plain(context.calcHealth(data)), { score: null, grade: '—' });
  assert.deepEqual(plain(data.beam.coverage), { compiled: 7, included: 6 });
  assert.equal(data.beam.producer.freshness, 'unverified');
  assert.equal(input[0].functions.length, 1, 'adapter must not mutate source analysis');
});

test('excluded or unread sources cannot leave dangling compiler connections', () => {
  const analyzed = analyzedFiles().filter(file => file.path !== 'lib/service.ex');
  const data = context.buildBeamAnalysisData({ analyzed, snapshot, excludePatterns: ['lib/service.ex'] });
  assert.equal(data.connections.length, 2);
  const paths = new Set(data.files.map(file => file.path));
  assert.ok(data.connections.every(edge => paths.has(edge.source) && paths.has(edge.target)));
  assert.deepEqual(plain(context.getConnectedFilePaths('lib/second.ex', data.connections)), []);
});

test('unavailable compiler evidence fails explicitly instead of falling back to guessed edges', () => {
  assert.throws(() => context.buildBeamAnalysisData({ analyzed: analyzedFiles(), snapshot: {
    status: 'unavailable', nodes: [], edges: [], warnings: ['No compiler artifacts'],
  }, excludePatterns: [] }), /compiler|unavailable|artifacts/i);
});
