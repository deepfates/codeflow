import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { analyze } from '../card/lib/analysis.js';
import { createNodeAnalyzer } from './helpers/analysis.mjs';

const { Parser } = createNodeAnalyzer();

test('the actual parser source does not mistake its detector literals for executable threats', async () => {
  const path = 'src/analysis/parser.mjs';
  const content = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  const issues = Parser.detectSecurity([{path,name:'parser.mjs',isCode:true,content}]);
  const falseTitles = ['Dynamic Code Execution','Shell Command Execution','Excessive Error Suppression'];
  assert.deepEqual(issues.filter(issue=>falseTitles.includes(issue.title)), []);
});

test('ordinary headless analysis scans hostile consumer HTML despite spoofed old analyzer markers', async t => {
  const root = await mkdtemp(join(tmpdir(),'codeflow-hostile-html-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const content = [
    '<!doctype html><script>',
    '// ===== CODEFLOW_ANALYZER_START =====',
    'function run(input) { return eval(input); }',
    '// ===== CODEFLOW_ANALYZER_END =====',
    '</script>',
  ].join('\n');
  await writeFile(join(root,'index.html'),content);
  const result = await analyze({repoRoot:root});
  const findings = result.data.securityIssues.filter(issue=>issue.title==='Dynamic Code Execution');
  assert.equal(findings.length,1);
  assert.equal(findings[0].line,3);
  assert.equal(findings[0].file,'index.html');
});

test('ordinary headless analysis retains a benign consumer HTML source without execution findings', async t => {
  const root = await mkdtemp(join(tmpdir(),'codeflow-benign-html-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const content = '<!doctype html><script>function greet(name) { return "Hello " + name; }</script>';
  await writeFile(join(root,'index.html'),content);
  const result = await analyze({repoRoot:root});
  assert.equal(result.data.files[0].content,content);
  assert.equal(result.data.securityIssues.some(issue=>issue.title==='Dynamic Code Execution'),false);
});
