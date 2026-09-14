import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRegexAnalyzer } from './helpers/analysis.mjs';
import * as architecture from '../src/analysis/architecture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const { Parser, buildAnalysisData } = createRegexAnalyzer();
const { buildArchitectureDiagram, generateMermaidBlockDiagram, getVisibleArchitectureBlocks, getArchitectureGroupOrder } = architecture;

test('architecture relationship projection preserves direction and all independent observations', () => {
  const observations = [
    {from:'a',to:'b',kind:'compile',label:'compile reference',evidence:'mix xref',line:4},
    {from:'a',to:'b',kind:'source-reference',label:'references',evidence:'tree-sitter:elixir',line:8},
    {from:'a',to:'b',kind:'compile',label:'compile reference',evidence:'mix xref',line:12},
    {from:'b',to:'a',kind:'runtime',label:'runtime reference',evidence:'mix xref'},
  ].map(Object.freeze);
  const before = JSON.stringify(observations);
  const relationships = architecture.groupArchitectureRelationships(observations);
  assert.equal(relationships.length, 2, 'reverse direction is a separate relationship');
  const forward = relationships.find(r => r.from === 'a');
  assert.deepEqual(Array.from(forward.kinds), ['compile','source-reference']);
  assert.deepEqual(Array.from(forward.labels), ['compile reference','references']);
  assert.deepEqual(Array.from(forward.evidence), ['mix xref','tree-sitter:elixir']);
  assert.equal(forward.observations.length, 3, 'repeated evidence can describe distinct source observations');
  assert.equal(forward.observations[2], observations[2]);
  assert.equal(JSON.stringify(observations), before, 'projection does not rewrite source evidence');
  assert.equal(architecture.groupArchitectureRelationships([
    {from:'a|b',to:'c'}, {from:'a',to:'b|c'},
  ]).length, 2, 'endpoint identifiers cannot collide through concatenation');
});

test('diagram statistics and compact edges share the visible directed relationships while full export keeps evidence', () => {
  const blocks = [
    {id:'a',title:'A',kind:'module',group:'Application',files:['a.ex']},
    {id:'b',title:'B',kind:'module',group:'Application',files:['b.ex']},
    {id:'test',title:'Tests',kind:'test',group:'Testing',files:['test.exs'],isTest:true},
  ];
  const dependencies = [
    {from:'a',to:'b',kind:'compile',label:'references',evidence:'mix xref'},
    {from:'a',to:'b',kind:'runtime',label:'references',evidence:'mix xref'},
    {from:'a',to:'b',kind:'source-reference',label:'references',evidence:'tree-sitter:elixir'},
    {from:'b',to:'a',kind:'database',label:'queries',evidence:'source analysis'},
    {from:'test',to:'a',kind:'tests',label:'tests'},
  ];
  const diagram = {profile:'generic',blocks,dependencies};
  const visible = getVisibleArchitectureBlocks(blocks,false,false);
  const stats = architecture.computeArchitectureStats(visible,dependencies);
  const compact = generateMermaidBlockDiagram(diagram,false,false,true);
  assert.equal(stats.dependencies, 2);
  assert.equal(stats.dependencyObservations, 4);
  assert.equal(stats.databaseTouchpoints, 1);
  assert.equal(compact.split('\n').filter(line => line.includes(' --> ')).length, stats.dependencies);
  assert.match(compact, /a --> b/);
  assert.match(compact, /b --> a/);
  assert.doesNotMatch(compact, /test -->/);
  const full = generateMermaidBlockDiagram(diagram,false,false,false);
  assert.equal(full.split('\n').filter(line => line.includes(' -->|')).length, 4);
  for (const kind of ['compile','runtime','source-reference','database']) assert.ok(full.includes('('+kind+')'), kind+' survives the labeled export');
  assert.equal(architecture.computeArchitectureStats(blocks,dependencies).dependencies, 3);
  assert.match(generateMermaidBlockDiagram(diagram,true,false,true), /test --> a/);
  assert.equal(diagram.dependencies, dependencies, 'full underlying observations remain available to JSON export');
});

async function collectRepoFiles(root) {
  const files = [];
  const ignored = new Set([
    '.git',
    'node_modules',
    'vendor',
    'dist',
    'build',
    'coverage',
    '.venv',
    'venv',
    'test-results',
  ]);

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !Parser.isIncluded(entry.name)) continue;
      const repoPath = relative(root, fullPath).replace(/\\/g, '/');
      files.push({
        fullPath,
        path: repoPath,
        name: basename(repoPath),
        folder: repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : 'root',
        isCode: Parser.isCode(entry.name),
      });
    }
  }

  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function analyzeCodeflowRepo() {
  const files = await collectRepoFiles(repoRoot);
  const analyzed = [];
  const allFns = [];

  for (const file of files) {
    const content = await readFile(file.fullPath, 'utf8');
    const layer = Parser.detectLayer(file.path);
    const actualIsCode =
      file.isCode !== false &&
      (!Parser.isScriptContainer(file.path) || Parser.hasEmbeddedCode(content, file.path));
    const functions = actualIsCode ? Parser.extract(content, file.path) : [];
    analyzed.push({
      path: file.path,
      name: file.name,
      folder: file.folder,
      content,
      functions,
      lines: content ? content.split('\n').length : 0,
      layer,
      churn: 0,
      isCode: actualIsCode,
    });
    if (actualIsCode) {
      functions.forEach((fn) => allFns.push(Object.assign({}, fn, { folder: file.folder, layer })));
    }
  }

  return buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
}

function blockPaths(diagram, includeTests, includeBuildOutput) {
  return getVisibleArchitectureBlocks(diagram.blocks || [], includeTests, includeBuildOutput).flatMap((block) => block.files || []);
}

function blockHasFile(block, suffix) {
  return (block.files || []).some((file) => file === suffix || file.endsWith('/' + suffix) || file.endsWith(suffix));
}

function hasDependency(diagram, fromSuffix, toSuffix, label) {
  const fromBlock = diagram.blocks.find((block) => blockHasFile(block, fromSuffix));
  const toBlock = diagram.blocks.find((block) => blockHasFile(block, toSuffix));
  assert.ok(fromBlock, `missing block ${fromSuffix}`);
  assert.ok(toBlock, `missing block ${toSuffix}`);
  return diagram.dependencies.some(
    (dep) =>
      dep.from === fromBlock.id &&
      dep.to === toBlock.id &&
      (!label || dep.label === label)
  );
}

test('codeflow architecture diagram hides tests by default', async () => {
  const data = await analyzeCodeflowRepo();
  const diagram = data.architectureDiagram;

  assert.ok(diagram);
  assert.equal(diagram.framework, 'Browser App');

  const visiblePaths = blockPaths(diagram, false, false);
  assert.ok(visiblePaths.some((path) => /index\.html$/i.test(path)));
  assert.ok(visiblePaths.some((path) => path === 'card/index.js'));
  assert.ok(visiblePaths.some((path) => path === 'src/node/analysis.mjs'));
  assert.ok(visiblePaths.some((path) => path === 'card/lib/collect.js'));
  assert.equal(
    visiblePaths.some((path) => /tests\//i.test(path) || /\.test\.mjs$/i.test(path)),
    false
  );
  assert.equal(
    visiblePaths.some((path) => /fixtures\//i.test(path)),
    false
  );

  const mermaid = generateMermaidBlockDiagram(diagram, false, false);
  assert.match(mermaid, /Browser App Shell/);
  assert.doesNotMatch(mermaid, /uses \d+ calls/i);
});

test('codeflow architecture diagram uses semantic module dependencies', async () => {
  const data = await analyzeCodeflowRepo();
  const diagram = data.architectureDiagram;

  assert.ok(hasDependency(diagram, 'card/index.js', 'card/lib/analysis.js'));
  assert.ok(hasDependency(diagram, 'card/lib/analysis.js', 'card/lib/collect.js'));
  assert.ok(hasDependency(diagram, 'card/index.js', 'card/lib/git.js'));
  assert.ok(hasDependency(diagram, 'card/lib/collect.js', 'card/lib/git.js', 'uses GitHub API'));
  assert.ok(hasDependency(diagram, 'card/lib/analysis.js', 'card/lib/state.js'));
  assert.ok(hasDependency(diagram, 'src/node/analysis.mjs', 'src/analysis/parser.mjs'));
  assert.ok(hasDependency(diagram, 'src/node/analysis.mjs', 'src/analysis/project.mjs'));
  assert.ok(hasDependency(diagram, 'card/lib/pr.js', 'card/lib/git.js', 'analyzes pull requests'));
  assert.ok(hasDependency(diagram, 'src/analysis/project.mjs', 'src/analysis/architecture.mjs'));

  const labels = diagram.dependencies.map((dep) => dep.label);
  assert.equal(labels.some((label) => /^uses \d+ calls?$/i.test(label)), false);
});

test('codeflow architecture diagram can include tests', async () => {
  const data = await analyzeCodeflowRepo();
  const diagram = data.architectureDiagram;
  const withTests = blockPaths(diagram, true);

  assert.ok(withTests.some((path) => path === 'tests/codeflow-golden.test.mjs'));
  const mermaid = generateMermaidBlockDiagram(diagram, true, false);
  assert.match(mermaid, /Testing/);
});

async function analyzeFixture(name) {
  const root = join(__dirname, 'fixtures', name);
  const files = await collectRepoFiles(root);
  const analyzed = [];
  const allFns = [];

  for (const file of files) {
    const content = await readFile(file.fullPath, 'utf8');
    const layer = Parser.detectLayer(file.path);
    const actualIsCode =
      file.isCode !== false &&
      (!Parser.isScriptContainer(file.path) || Parser.hasEmbeddedCode(content, file.path));
    const functions = actualIsCode ? Parser.extract(content, file.path) : [];
    analyzed.push({
      path: file.path,
      name: file.name,
      folder: file.folder,
      content,
      functions,
      lines: content ? content.split('\n').length : 0,
      layer,
      churn: 0,
      isCode: actualIsCode,
    });
    if (actualIsCode) {
      functions.forEach((fn) => allFns.push(Object.assign({}, fn, { folder: file.folder, layer })));
    }
  }

  return buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
}

test('web-app fixture uses semantic groups and hides build output', async () => {
  const data = await analyzeFixture('web-app-world');
  const diagram = data.architectureDiagram;

  assert.ok(diagram);
  assert.equal(diagram.profile, 'web-app');

  const visiblePaths = blockPaths(diagram, false, false);
  assert.equal(
    visiblePaths.some((path) => /(^|\/)out\//i.test(path) || /page-deadbeef/i.test(path)),
    false
  );
  assert.equal(getVisibleArchitectureBlocks(diagram.blocks, false, false).some((block) => block.isTest), false);

  const groups = new Set(getVisibleArchitectureBlocks(diagram.blocks, false, false).map((b) => b.group));
  assert.ok(groups.has('App Entry / Shell') || groups.has('Frontend Routes / Views'));
  assert.ok(
    groups.has('Backend / API Layer') ||
      groups.has('Services / Business Logic') ||
      groups.has('Configuration') ||
      groups.has('Shared / Utilities')
  );

  assert.ok(diagram.hiddenSummary);
  assert.ok(diagram.hiddenSummary.build >= 1 || diagram.hiddenSummary.tests >= 1);

  const mermaid = generateMermaidBlockDiagram(diagram, false, false);
  assert.doesNotMatch(mermaid, /uses \d+ calls/i);
  const order = getArchitectureGroupOrder('web-app');
  assert.ok(order.includes('App Entry / Shell'));
  assert.ok(order.includes('Frontend Routes / Views'));

  const forbiddenRoutes = [
    'Route /a-backend/src/config',
    'Route /hooks',
    'Route /ui/components',
    'Route /platforms/youtube/schema',
    'Route /a-backend/src/routes',
  ];
  for (const label of forbiddenRoutes) {
    assert.doesNotMatch(mermaid, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(mermaid, /LandingPage.*global-error/i);
  assert.match(mermaid, /Global Error Boundary|global-error/i);
});

test('web-app fixture classifies backend barrels and shared indexes without routes', async () => {
  const data = await analyzeFixture('web-app-world');
  const diagram = data.architectureDiagram;
  const routeBlocks = getVisibleArchitectureBlocks(diagram.blocks, false, false).filter(
    (block) => block.role === 'frontend-route' || (block.route && block.kind === 'page')
  );

  for (const block of routeBlocks) {
    const files = (block.files || []).join(' ');
    assert.equal(/a-backend\/src\/(config|middleware|routes)\/index\.js/i.test(files), false);
    assert.equal(/src\/hooks\/index\.ts/i.test(files), false);
    assert.equal(/src\/ui\/components\/index\.ts/i.test(files), false);
    assert.equal(/src\/platforms\/youtube\/schema\/index\.ts/i.test(files), false);
  }
});

test('native architecture follows transitive imports from core entry points regardless of input order', () => {
  const sources = {
    'src/core/second.mjs':'export function second() { return 2; }',
    'src/core/unused.mjs':'export function unused() { return 0; }',
    'src/core/first.mjs':"import { second } from './second.mjs'; export function first() { return second(); }",
    'card/lib/entry.js':"import { first } from '../../src/core/first.mjs'; export function run() { return first(); }",
    'index.html':'<!doctype html><title>Example</title>',
  };
  function diagramFor(entries) {
    return buildArchitectureDiagram(entries.map(([path,content])=>({path,content,name:basename(path),
      folder:dirname(path),isCode:Parser.isCode(path),functions:Parser.extract(content,path),lines:1})));
  }
  const entries = Object.entries(sources);
  for (const ordered of [entries,[...entries].reverse()]) {
    const diagram = diagramFor(ordered);
    const visible = blockPaths(diagram,false,false);
    assert.ok(visible.includes('src/core/first.mjs'));
    assert.ok(visible.includes('src/core/second.mjs'));
    assert.equal(visible.includes('src/core/unused.mjs'),false,'unreferenced generic modules are not invented as overview entry points');
    assert.ok(hasDependency(diagram,'card/lib/entry.js','src/core/first.mjs'));
    assert.ok(hasDependency(diagram,'src/core/first.mjs','src/core/second.mjs'));
  }
});
