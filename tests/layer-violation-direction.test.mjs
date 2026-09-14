import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegexAnalyzer } from './helpers/analysis.mjs';

const { Parser, buildAnalysisData } = createRegexAnalyzer();

// Shared connection convention: connection {source: fileDefiningFn (imported), target: fileCallingFn (importer)}.
// layerOrder: lower number = higher/topmost layer. services=2, utils/lib=4. utils importing UP from services = violation.
const files = [
  { path: 'src/services/userService.ts', layer: 'services' },
  { path: 'src/lib/helper.ts', layer: 'utils' },
];

test('healthy downward dependency (service uses a util) is NOT a violation', () => {
  // userService (services) calls a function defined in lib/helper (utils):
  // caller = userService, definition = helper => {source: helper, target: userService}
  const violations = Parser.detectLayerViolations(files, [
    { source: 'src/lib/helper.ts', target: 'src/services/userService.ts', fn: 'formatDate' },
  ]);
  assert.equal(violations.length, 0);
});

test('genuine upward dependency (util reaches into a service) IS a violation, correctly attributed', () => {
  // helper (utils) calls a function defined in userService (services):
  // caller = helper, definition = userService => {source: userService, target: helper}
  const violations = Parser.detectLayerViolations(files, [
    { source: 'src/services/userService.ts', target: 'src/lib/helper.ts', fn: 'fetchUser' },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].from, 'src/lib/helper.ts');
  assert.equal(violations[0].to, 'src/services/userService.ts');
  assert.match(violations[0].suggestion, /utils should not import from services/);
});

test('detectLayer classifies root-level layer folders, not just nested ones', () => {
  // Root-level folders (no leading path segment) must match the same as nested ones.
  assert.equal(Parser.detectLayer('services/userService.ts'), 'services');
  assert.equal(Parser.detectLayer('ui/Button.tsx'), 'ui');
  assert.equal(Parser.detectLayer('lib/helper.ts'), 'utils');
  // Nested paths keep their existing classification (regression guard).
  assert.equal(Parser.detectLayer('src/services/userService.ts'), 'services');
  assert.equal(Parser.detectLayer('src/lib/helper.ts'), 'utils');
  // A file with no recognizable layer folder still falls through to the default.
  assert.equal(Parser.detectLayer('src/app.js'), 'utils');
});

test('a test file importing a util or service is NOT flagged as a layer violation', () => {
  const testFiles = [
    { path: 'tests/userService.test.ts', layer: Parser.detectLayer('tests/userService.test.ts') },
    { path: 'src/lib/helper.ts', layer: Parser.detectLayer('src/lib/helper.ts') },
    { path: 'src/services/userService.ts', layer: Parser.detectLayer('src/services/userService.ts') },
  ];
  // The test file calls helper() and createUser() — conns point {source: definition, target: caller=the test file}.
  const conns = [
    { source: 'src/lib/helper.ts', target: 'tests/userService.test.ts', fn: 'formatDate' },
    { source: 'src/services/userService.ts', target: 'tests/userService.test.ts', fn: 'createUser' },
  ];
  const violations = Parser.detectLayerViolations(testFiles, conns);
  assert.equal(violations.length, 0);
});

test('coupling finding describes the consumer importing nine providers', async () => {
  const sources = Object.fromEntries(Array.from({length:9},(_,i)=>['src/provider'+i+'.js','export function provider'+i+'() { return '+i+'; }']));
  sources['src/consumer.js'] = Array.from({length:9},(_,i)=>"import { provider"+i+" } from './provider"+i+".js';").join('\n')+
    '\nexport function consume() { '+Array.from({length:9},(_,i)=>'provider'+i+'();').join(' ')+' }';
  const analyzed = Object.entries(sources).map(([path,content])=>({path,name:path.split('/').pop(),folder:'src',content,
    isCode:true,lines:content.split('\n').length,layer:Parser.detectLayer(path),functions:Parser.extract(content,path)}));
  const result = await buildAnalysisData({analyzed,allFns:analyzed.flatMap(file=>file.functions.map(fn=>({...fn,folder:file.folder,layer:file.layer})))});
  const finding = result.issues.find(issue=>/Highly Coupled/.test(issue.title));
  assert.ok(finding,'nine imported providers produce a coupling finding');
  assert.match(finding.desc,/import 8\+ other/);
  assert.equal(finding.items.length,1);
  assert.equal(finding.items[0].path||finding.items[0].file,'src/consumer.js','the consumer, not the providers, is highly coupled');
});

test('Python test files and test-folder importers are not flagged (layer=test), and .spec files outside tests/ stay excluded', () => {
  // Python test file (detectLayer -> 'test', but isArchitectureTestFile does NOT match .py)
  const pyFiles = [
    { path: 'myapp/test_service.py', layer: Parser.detectLayer('myapp/test_service.py') },
    { path: 'myapp/services/foo.py', layer: Parser.detectLayer('myapp/services/foo.py') },
  ];
  const pyViolations = Parser.detectLayerViolations(pyFiles, [
    { source: 'myapp/services/foo.py', target: 'myapp/test_service.py', fn: 'createUser' },
  ]);
  assert.equal(pyViolations.length, 0);

  // A .spec file outside a tests/ dir: detectLayer -> 'utils' (NOT test), but isArchitectureTestFile matches it.
  // This guards that the isArchitectureTestFile half of the condition still covers such files.
  const specFiles = [
    { path: 'src/utils/user.spec.ts', layer: Parser.detectLayer('src/utils/user.spec.ts') },
    { path: 'src/services/user.ts', layer: Parser.detectLayer('src/services/user.ts') },
  ];
  const specViolations = Parser.detectLayerViolations(specFiles, [
    { source: 'src/services/user.ts', target: 'src/utils/user.spec.ts', fn: 'createUser' },
  ]);
  assert.equal(specViolations.length, 0);
});
