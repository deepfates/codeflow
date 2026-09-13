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
function nativeData(files = analyzedFiles()) {
  const functions = files.flatMap(file => file.functions);
  return { files, functions, connections: [], fnStats: {}, folders: ['lib', 'test'], tree: context.buildTree(files),
    issues: [], securityIssues: [], patterns: [], duplicates: [], layerViolations: [], suggestions: [], deadFunctions: [],
    stats: { files: files.length, functions: functions.length, dead: 0, connections: 0, loc: 20 } };
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
  const data = context.buildBeamAnalysisData({ data: nativeData(), snapshot, excludePatterns: [] });
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

test('compiler enrichment retains source analysis and isolated files', () => {
  const input = analyzedFiles();
  const data = context.buildBeamAnalysisData({ data: nativeData(input), snapshot, excludePatterns: [] });
  assert.equal(data.files.length, 7);
  assert.ok(data.files.some(file => file.path === 'lib/isolated.ex'));
  assert.ok(data.files.some(file => file.path === 'test/caller_test.exs'));
  assert.ok(data.files.every(file => file.path !== 'lib/deleted.ex'));
  assert.ok(data.files.every(file => file.content === input.find(source => source.path === file.path).content));
  assert.deepEqual(plain(data.functions), plain(input.flatMap(file => file.functions)));
  for (const name of ['deadFunctions', 'issues', 'securityIssues']) assert.deepEqual(plain(data[name]), []);
  assert.deepEqual(plain(data.fnStats), {});
  assert.equal(typeof context.calcHealth(data).score, 'number');
  assert.deepEqual(plain(data.beam.coverage), { compiled: 7, included: 6 });
  assert.equal(data.beam.producer.freshness, 'unverified');
  assert.equal(input[0].functions.length, 1, 'adapter must not mutate source analysis');
});

test('excluded or unread sources cannot leave dangling compiler connections', () => {
  const analyzed = analyzedFiles().filter(file => file.path !== 'lib/service.ex');
  const data = context.buildBeamAnalysisData({ data: nativeData(analyzed), snapshot, excludePatterns: ['lib/service.ex'] });
  assert.equal(data.connections.length, 2);
  const paths = new Set(data.files.map(file => file.path));
  assert.ok(data.connections.every(edge => paths.has(edge.source) && paths.has(edge.target)));
  assert.deepEqual(plain(context.getConnectedFilePaths('lib/second.ex', data.connections)), []);
});

test('unavailable compiler evidence retains the native analysis', () => {
  const data = context.buildBeamAnalysisData({ data: nativeData(), snapshot: {
    status: 'unavailable', nodes: [], edges: [], warnings: ['No compiler artifacts'],
  }, excludePatterns: [] });
  assert.equal(data.files.length, 7);
  assert.deepEqual(plain(data.connections), []);
  assert.equal(context.calcHealth(data).score, 100);
});

const canvasFixture = () => context.buildBeamAnalysisData({ data: nativeData(), snapshot });
test('workspace restoration retains navigation and placement while pruning removed files', () => {
  const restored = context.restoreWorkspace({version:1,scope:'lib',selected:'lib/caller.ex',view:'code',
    opened:['lib/caller.ex','deleted.ex'],placements:{'lib/caller.ex':{x:120,y:180,left:0,top:0},'deleted.ex':{x:1,y:1}},
    sizes:{},pinned:['lib/caller.ex','deleted.ex'],camera:{k:0.8,x:-10,y:30}},canvasFixture());
  assert.deepEqual(plain(restored.opened),['lib/caller.ex']);
  assert.deepEqual(plain(restored.pinned),['lib/caller.ex']);
  assert.equal(restored.scope,'lib');assert.equal(restored.selected,'lib/caller.ex');
  assert.equal(restored.placements['lib/caller.ex'].x,120);
  assert.equal(restored.placements['deleted.ex'],undefined);
  assert.deepEqual(plain(restored.camera),{k:0.8,x:-10,y:30});
  assert.equal(context.restoreWorkspace({version:2},canvasFixture()),null);
});
