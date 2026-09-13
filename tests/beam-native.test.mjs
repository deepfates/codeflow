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
  assert.equal(data.files.length, 7);
  assert.ok(data.files.some(file => file.path === 'lib/isolated.ex'));
  assert.ok(data.files.some(file => file.path === 'test/caller_test.exs'));
  assert.ok(data.files.every(file => file.path !== 'lib/deleted.ex'));
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

test('unavailable compiler evidence retains sources without guessed edges or grades', () => {
  const data = context.buildBeamAnalysisData({ analyzed: analyzedFiles(), snapshot: {
    status: 'unavailable', nodes: [], edges: [], warnings: ['No compiler artifacts'],
  }, excludePatterns: [] });
  assert.equal(data.files.length, 7);
  assert.deepEqual(plain(data.connections), []);
  assert.equal(context.calcHealth(data).score, null);
});

const canvasFixture = () => context.buildBeamAnalysisData({ analyzed: analyzedFiles(), snapshot });
const paths = files => plain(files.map(file => file.path)).sort();

function assertFocusedCanvas(helper) {
  const data = canvasFixture();
  assert.deepEqual(paths(helper(data, null, 'lib/caller.ex', ['lib/caller.ex'])),
    ['lib/caller.ex', 'lib/data.ex', 'lib/macro.ex', 'lib/service.ex']);
  assert.deepEqual(paths(helper(data, null, 'lib/isolated.ex', ['lib/caller.ex', 'lib/isolated.ex'])),
    ['lib/caller.ex', 'lib/isolated.ex'], 'changing selection retains open cards without their former neighbors');
  assert.equal(data.files.length, 7, 'view filtering must preserve the full analysis for Graph');
}

test('Code canvas shows the selected neighborhood and retains open cards when selection changes', () => {
  assertFocusedCanvas(context.beamCodeCanvasFiles);
});

test('Code canvas starts empty without selection and preserves ordinary folder scope', () => {
  const data = canvasFixture();
  assert.deepEqual(paths(context.beamCodeCanvasFiles(data, null, null, [])), []);
  assert.deepEqual(paths(context.beamCodeCanvasFiles(data, null, null, ['lib/isolated.ex'])), ['lib/isolated.ex']);
  data.files.push({ path: 'bench/helper.ex', folder: 'bench' }, { path: 'lib/nested/helper.ex', folder: 'lib/nested' });
  assert.deepEqual(paths(context.beamCodeCanvasFiles(data, 'bench', 'lib/caller.ex', ['lib/caller.ex'])), ['bench/helper.ex']);
  assert.deepEqual(paths(context.beamCodeCanvasFiles(data, 'lib/nested', null, [])), ['lib/nested/helper.ex']);
  assert.equal(context.beamCodeCanvasFiles(data, 'lib', null, []).length, 7);
});

test('BEAM exploration is never blocked by a file-count gate', () => {
  const data = { beam: {}, files: Array.from({ length: 50 }, (_, i) => ({ path: `lib/nested/f${i}.ex`, folder: 'lib/nested' })) };
  assert.equal(context.codeViewRootGateActive(data, null, null, [], 50), false);
  assert.equal(context.codeViewRootGateActive(data, null, null, [], 75), false);
  assert.equal(context.codeViewRootGateActive(data, 'lib', null, [], 50), false);
  assert.equal(context.codeViewRootGateActive(data, null, 'lib/nested/f0.ex', [], 50), false);
  assert.equal(context.codeViewRootGateActive(data, null, null, ['lib/nested/f0.ex'], 50), false);
});

test('focused-canvas assertion rejects a temporary regression to rendering every file', () => {
  const mutant = {};
  vm.createContext(mutant);
  const source = context.beamCodeCanvasFiles.toString();
  const bodyStart = source.indexOf('{') + 1;
  assert.ok(bodyStart > 0);
  // Insert a deliberate early return at the function body, not an escaping rule.
  const broken = source.slice(0, bodyStart) + ' return data.files;' + source.slice(bodyStart);
  assert.notEqual(broken, source);
  vm.runInContext(broken, mutant);
  assert.throws(() => assertFocusedCanvas(mutant.beamCodeCanvasFiles), { name: 'AssertionError' });
});

function assertProjectScope(projectScope) {
  const data = canvasFixture();
  data.files.push({path:'README.md',folder:'',lines:3,functions:[]});
  const root = projectScope(data, null);
  assert.deepEqual(paths(root.files), ['README.md','folder:lib','folder:test']);
  assert.equal(root.files.find(f => f.groupPath === 'lib').members.length, 6);
  const lib = projectScope(data, 'lib');
  assert.equal(lib.files.length, 6);
  assert.equal(lib.connections.length, 4);
  assert.deepEqual(plain(lib.connections.map(e => e.kind)).sort(), ['compile','export','runtime','runtime']);
  assert.equal(projectScope(data,'test').files[0].path, 'test/caller_test.exs');
}
test('folder overview expands to retained source and typed relationships', () => {
  assertProjectScope(context.projectGraphScope);
});
test('folder overview regression rejects an ungrouped whole-project canvas', () => {
  assert.throws(() => assertProjectScope(data => data), {name:'AssertionError'});
});

test('workspace restoration retains navigation and placement while pruning removed files', () => {
  const restored = context.restoreBeamWorkspace({version:1,scope:'lib',selected:'lib/caller.ex',view:'code',
    opened:['lib/caller.ex','deleted.ex'],placements:{'lib/caller.ex':{x:120,y:180,left:0,top:0},'deleted.ex':{x:1,y:1}},
    sizes:{},pinned:['lib/caller.ex','deleted.ex'],camera:{k:0.8,x:-10,y:30}},canvasFixture());
  assert.deepEqual(plain(restored.opened),['lib/caller.ex']);
  assert.deepEqual(plain(restored.pinned),['lib/caller.ex']);
  assert.equal(restored.scope,'lib');assert.equal(restored.selected,'lib/caller.ex');
  assert.equal(restored.placements['lib/caller.ex'].x,120);
  assert.equal(restored.placements['deleted.ex'],undefined);
  assert.deepEqual(plain(restored.camera),{k:0.8,x:-10,y:30});
  assert.equal(context.restoreBeamWorkspace({version:2},canvasFixture()),null);
});
