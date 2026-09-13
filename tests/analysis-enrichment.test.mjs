import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const context = { console, getSecurityScanContent: file => file.content || '', isSanitizedPreviewRenderer: () => false };
vm.createContext(context);
const start = html.indexOf('// ===== CODEFLOW_ANALYZER_START =====');
const end = html.indexOf('// ===== CODEFLOW_ANALYZER_END =====', start);
vm.runInContext(html.slice(start, end) + '\nthis.Parser = Parser;', context);
vm.runInContext(html.slice(html.indexOf('function calcBlast('), html.indexOf('// ===== CODEFLOW_METRICS_END =====')), context);
const plain = value => JSON.parse(JSON.stringify(value));

async function analyze() {
  const sources = {
    'lib/server.ex': 'defmodule Server do\n  use GenServer\n  def init(state), do: {:ok, state}\n  def public_api(), do: :ok\nend',
    'lib/client.ex': 'defmodule Client do\n  def run(), do: Server.public_api()\nend',
    'assets/helper.js': 'export function helper(input) { return eval(input); }',
    'assets/main.js': "import { helper } from './helper.js';\nexport function main(input) { return helper(input); }",
    'README.md': '# Example\nSee [helper](assets/helper.js).',
  };
  const analyzed = Object.entries(sources).map(([path, content]) => ({
    path, name: path.split('/').pop(), folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'root',
    content, lines: content.split('\n').length, isCode: context.Parser.isCode(path),
    functions: context.Parser.isCode(path) ? context.Parser.extract(content, path) : [],
    layer: context.Parser.detectLayer(path), churn: 0,
  }));
  return context.buildAnalysisData({ analyzed, allFns: analyzed.flatMap(f => f.functions.map(fn => ({ ...fn, folder: f.folder, layer: f.layer }))), yieldFn: async () => {} });
}
const snapshot = { status: 'ready', nodes: [{ path: 'lib/server.ex' }, { path: 'lib/client.ex' }],
  edges: [{ source: 'lib/client.ex', target: 'lib/server.ex', kind: 'runtime' }] };

test('native mixed-language findings, symbols, document links and architecture survive compiler enrichment', async () => {
  const source = await analyze();
  assert.ok(source.functions.length > 0);
  assert.ok(source.securityIssues.length > 0, 'fixture must exercise security analysis');
  assert.ok(source.connections.some(c => c.source === 'assets/helper.js' && c.target === 'assets/main.js'));
  assert.ok(source.connections.some(c => c.target === 'README.md' || c.source === 'README.md'), 'fixture must exercise documentation links');
  const before = plain(source);
  const enriched = context.buildBeamAnalysisData({ data: source, snapshot });
  for (const field of ['functions', 'securityIssues', 'patterns', 'duplicates', 'layerViolations', 'suggestions', 'architectureDiagram', 'tree']) {
    assert.deepEqual(plain(enriched[field]), before[field], field);
  }
  assert.deepEqual(plain(source), before, 'enrichment must not mutate native results');
  assert.equal(enriched.connections.length, source.connections.length + 1);
  assert.ok(enriched.connections.some(c => c.evidence === 'mix xref' && c.source === 'lib/server.ex' && c.target === 'lib/client.ex'));
  for (const file of source.files) {
    const actual = enriched.files.find(f => f.path === file.path);
    assert.deepEqual(plain(actual.functions), plain(file.functions));
    assert.deepEqual(plain(actual.complexity), plain(file.complexity));
    assert.equal(actual.parserProvenance, file.parserProvenance);
  }
});

test('compiler refresh replaces only compiler edges, including unavailable snapshots', async () => {
  const source = await analyze();
  const first = context.buildBeamAnalysisData({ data: source, snapshot });
  const again = context.buildBeamAnalysisData({ data: first, snapshot });
  assert.deepEqual(plain(again.connections), plain(first.connections));
  const absent = context.buildBeamAnalysisData({ data: again, snapshot: { status: 'unavailable', nodes: [], edges: [] } });
  assert.deepEqual(plain(absent.connections), plain(first.connections.filter(c => c.evidence !== 'mix xref')));
  assert.deepEqual(plain(absent.securityIssues), plain(source.securityIssues));
});

test('Elixir caller uncertainty is attached to retained candidates and does not penalize health', async () => {
  const source = await analyze();
  const callback = { name: 'init', file: 'lib/server.ex', line: 3 };
  source.deadFunctions = [callback];
  source.stats.dead = 1;
  source.fnStats.callback = { ...callback, internal: 0, external: 0 };
  source.issues.push({ type: 'warning', title: '1 Unused Functions', items: [callback] });
  source.suggestions.push({ title: 'Remove Dead Code', desc: 'Remove unused functions' });
  const enriched = context.buildBeamAnalysisData({ data: source, snapshot });
  assert.equal(enriched.deadFunctions.length, 1);
  assert.equal(enriched.deadFunctions[0].certainty, 'unverified');
  assert.equal(enriched.stats.dead, 1);
  assert.ok(enriched.suggestions.some(suggestion => suggestion.certainty === 'unverified'));
  assert.ok(!enriched.suggestions.some(suggestion => suggestion.title === 'Remove Dead Code'));
  assert.equal(enriched.fnStats.callback.usageCertainty, 'unverified');
  assert.ok(enriched.issues.some(issue => issue.certainty === 'unverified' && issue.items[0].file === callback.file));
  const withoutCandidates = { ...enriched, deadFunctions: [], stats: { ...enriched.stats, dead: 0 } };
  assert.deepEqual(plain(context.calcHealth(enriched)), plain(context.calcHealth(withoutCandidates)));
});

test('compiler topology enriches existing architecture blocks and refreshes their exported diagram', async () => {
  const source = await analyze();
  source.architectureDiagram.blocks = [
    { id: 'Client', label: 'Client', files: ['lib/client.ex'], group: 'Application', kind: 'module' },
    { id: 'Server', label: 'Server', files: ['lib/server.ex'], group: 'Application', kind: 'module' },
  ];
  source.architectureDiagram.dependencies = [];
  const enriched = context.buildBeamAnalysisData({ data: source, snapshot });
  assert.deepEqual(plain(enriched.architectureDiagram.blocks), plain(source.architectureDiagram.blocks));
  assert.deepEqual(plain(enriched.architectureDiagram.dependencies), [
    { from: 'Client', to: 'Server', kind: 'runtime', label: 'runtime reference', confidence: 'high', evidence: 'mix xref' },
  ]);
  assert.equal(enriched.architectureDiagram.stats.dependencies, 1);
  assert.match(enriched.architectureDiagram.mermaid, /runtime reference/);
  const empty = context.buildBeamAnalysisData({ data: enriched, snapshot: { status: 'ready', nodes: snapshot.nodes, edges: [] } });
  assert.equal(empty.architectureDiagram.dependencies.length, 0);
  assert.doesNotMatch(empty.architectureDiagram.mermaid, /runtime reference/);
});
