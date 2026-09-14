import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyze } from '../card/lib/analysis.js';

test('headless analysis treats consumer HTML and spoofed analysis modules as data, never executable tooling', async t => {
  const root = await mkdtemp(join(tmpdir(),'codeflow-untrusted-consumer-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'src/node'),{recursive:true});
  const marker = join(root,'executed');
  await writeFile(join(root,'package.json'),'{"type":"module"}');
  await writeFile(join(root,'src/node/analysis.mjs'),
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('consumer code executed');`);
  await writeFile(join(root,'index.html'),'<script>throw new Error("consumer HTML executed"); function run(input) { return eval(input); }</script>');
  const result = await analyze({repoRoot:root});
  assert.equal(result.schemaVersion,1);
  assert.ok(result.data.files.some(file=>file.path==='src/node/analysis.mjs'));
  assert.ok(result.data.securityIssues.some(issue=>issue.title==='Dynamic Code Execution'&&issue.path==='index.html'));
  await assert.rejects(access(marker),{code:'ENOENT'});
});
