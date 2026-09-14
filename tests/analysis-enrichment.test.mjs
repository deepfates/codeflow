import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegexAnalyzer, createNodeAnalyzer } from './helpers/analysis.mjs';
import { buildBeamAnalysisData } from '../src/analysis/evidence.mjs';
import { calcHealth } from '../src/analysis/metrics.mjs';

const { Parser, buildAnalysisData } = createRegexAnalyzer();
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
    content, lines: content.split('\n').length, isCode: Parser.isCode(path),
    functions: Parser.isCode(path) ? Parser.extract(content, path) : [],
    layer: Parser.detectLayer(path), churn: 0,
  }));
  return buildAnalysisData({ analyzed, allFns: analyzed.flatMap(f => f.functions.map(fn => ({ ...fn, folder: f.folder, layer: f.layer }))), yieldFn: async () => {} });
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
  const enriched = buildBeamAnalysisData({ data: source, snapshot });
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
  const first = buildBeamAnalysisData({ data: source, snapshot });
  const again = buildBeamAnalysisData({ data: first, snapshot });
  assert.deepEqual(plain(again.connections), plain(first.connections));
  const absent = buildBeamAnalysisData({ data: again, snapshot: { status: 'unavailable', nodes: [], edges: [] } });
  assert.deepEqual(plain(absent.connections), plain(first.connections.filter(c => c.evidence !== 'mix xref')));
  assert.deepEqual(plain(absent.securityIssues), plain(source.securityIssues));
});

async function sourceOnly(extension) {
  const { Parser, buildAnalysisData } = createNodeAnalyzer();
  const content = extension === 'ex'
    ? 'defmodule Candidates do\n' + Array.from({ length: 12 }, (_, i) => `  def candidate_${i}(value), do: value`).join('\n') + '\nend'
    : Array.from({ length: 12 }, (_, i) => `function candidate_${i}(value) { return value + ${i}; }`).join('\n');
  const path = `lib/candidates.${extension}`;
  const file = { path, name: `candidates.${extension}`, folder: 'lib', content,
    lines: content.split('\n').length, isCode: true, layer: Parser.detectLayer(path),
    functions: Parser.extract(content, path), churn: 0 };
  return buildAnalysisData({ analyzed: [file], allFns: file.functions, yieldFn: async () => {} });
}

test('ordinary source analysis retains Elixir candidates with uncertainty before any compiler evidence', async () => {
  const source = await sourceOnly('ex');
  assert.equal(source.files[0].elixir.status, 'ready', 'exercise the real grammar');
  assert.equal(source.deadFunctions.length, 12);
  assert.equal(source.stats.dead, 12, 'candidates remain available to existing drilldowns');
  assert.ok(source.deadFunctions.every(fn => fn.certainty === 'unverified'));
  assert.ok(Object.values(source.fnStats).every(fn => fn.usageCertainty === 'unverified'));
  assert.ok(source.issues.some(issue => issue.certainty === 'unverified' && issue.items.length === 12));
  assert.ok(source.suggestions.some(suggestion => suggestion.title === 'Review Functions Without Observed Callers'));
  assert.ok(!source.suggestions.some(suggestion => suggestion.title === 'Remove Dead Code'));
  const withoutCandidates = { ...source, deadFunctions: [], stats: { ...source.stats, dead: 0 } };
  assert.deepEqual(calcHealth(source), calcHealth(withoutCandidates));
  for (const status of ['ready', 'unavailable']) {
    const enriched = buildBeamAnalysisData({ data: source, snapshot: { status, nodes: [], edges: [] } });
    for (const field of ['deadFunctions', 'fnStats', 'issues', 'suggestions']) {
      assert.deepEqual(enriched[field], source[field], `${status}: compiler availability must not rewrite ${field}`);
    }
    assert.deepEqual(calcHealth(enriched), calcHealth(source));
  }
});

test('JavaScript caller assessments retain their existing semantics', async () => {
  const source = await sourceOnly('js');
  assert.equal(source.deadFunctions.length, 12);
  assert.ok(source.deadFunctions.every(fn => fn.certainty === undefined));
  assert.ok(Object.values(source.fnStats).every(fn => fn.usageCertainty === undefined));
  assert.ok(source.issues.some(issue => issue.title === '12 Unused Functions'));
  assert.ok(source.suggestions.some(suggestion => suggestion.title === 'Remove Dead Code'));
  const withoutCandidates = { ...source, deadFunctions: [], stats: { ...source.stats, dead: 0 } };
  assert.notDeepEqual(calcHealth(source), calcHealth(withoutCandidates));
});

test('compiler topology enriches existing architecture blocks and refreshes their exported diagram', async () => {
  const source = await analyze();
  source.architectureDiagram.blocks = [
    { id: 'Client', label: 'Client', files: ['lib/client.ex'], group: 'Application', kind: 'module' },
    { id: 'Server', label: 'Server', files: ['lib/server.ex'], group: 'Application', kind: 'module' },
  ];
  source.architectureDiagram.dependencies = [];
  const enriched = buildBeamAnalysisData({ data: source, snapshot });
  assert.deepEqual(plain(enriched.architectureDiagram.blocks), plain(source.architectureDiagram.blocks));
  assert.deepEqual(plain(enriched.architectureDiagram.dependencies), [
    { from: 'Client', to: 'Server', kind: 'runtime', label: 'runtime reference', confidence: 'high', evidence: 'mix xref' },
  ]);
  assert.equal(enriched.architectureDiagram.stats.dependencies, 1);
  assert.match(enriched.architectureDiagram.mermaid, /runtime reference/);
  const empty = buildBeamAnalysisData({ data: enriched, snapshot: { status: 'ready', nodes: snapshot.nodes, edges: [] } });
  assert.equal(empty.architectureDiagram.dependencies.length, 0);
  assert.doesNotMatch(empty.architectureDiagram.mermaid, /runtime reference/);
});

test('analysis retains exact source for the caller and source navigation', async () => {
  const content = 'export function run(value) {\n  return value + 1;\n}\n';
  const file = {path:'src/run.js',name:'run.js',folder:'src',content,isCode:true,lines:4,
    layer:'utils',functions:Parser.extract(content,'src/run.js')};
  const result = await buildAnalysisData({analyzed:[file],allFns:file.functions});
  assert.equal(file.content,content,'analysis must not erase source owned by its caller');
  assert.equal(result.files[0].content,content,'source navigation receives the original text');
});
