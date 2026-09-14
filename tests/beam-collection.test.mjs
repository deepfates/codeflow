import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWatchFiles, parseCliArgs } from '../cli/codeflow.mjs';
import { buildAnalyzed } from '../card/lib/collect.js';
import { createNodeAnalyzer } from './helpers/analysis.mjs';
import { filterAnalyzableLocalFiles } from '../src/project/exclusions.mjs';

const { Parser } = createNodeAnalyzer();
test('local and headless acquisition exclude dependency and build trees while retaining application source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-mix-collection-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  for (const directory of ['lib', 'apps/web/lib', 'deps/pkg/lib', '_build/dev/lib', 'apps/web/deps/pkg', '.elixir_ls']) {
    await mkdir(join(root,directory), {recursive:true});
    await writeFile(join(root,directory,'sample.ex'), 'defmodule Sample do\nend');
  }
  const expected=['apps/web/lib/sample.ex','lib/sample.ex'];
  assert.deepEqual((await listWatchFiles(root)).map(f=>f.path).sort(),expected);
  assert.deepEqual((await buildAnalyzed(root,Parser,[])).analyzed.map(f=>f.path).sort(),expected);
});
test('CLI can print the Codeflow URL without opening the default browser', () => {
  assert.deepEqual(parseCliArgs(['node','codeflow','/project','--beam','--no-open','--port','4180']),
    {port:4180,target:'/project',beam:true,noOpen:true});
});

test('browser folder and archive collection apply the same Mix defaults without hiding docs or tests', async () => {
  const paths=['lib/deps.ex','lib/_build.ex','apps/web/lib/server.ex','test/server_test.exs','docs/design.md',
    'deps/pkg/lib/server.ex','apps/web/deps/pkg/lib/server.ex','_build/dev/lib/server.ex','.elixir_ls/build/server.ex'];
  const actual=filterAnalyzableLocalFiles(paths.map(path=>({path,name:path.split('/').pop()})),[]);
  assert.deepEqual(Array.from(actual,f=>f.path),paths.slice(0,5));
});
