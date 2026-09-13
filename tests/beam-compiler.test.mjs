import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectBeamGraph, translateXref, XREF_ARGS } from '../cli/beam.mjs';
import { createCodeflowServer, parseCliArgs } from '../cli/codeflow.mjs';

const raw = { 'lib/caller.ex': { 'lib/macro.ex': 'compile', 'lib/data.ex': 'export', 'lib/service.ex': 'runtime' }, 'lib/isolated.ex': {} };

test('xref preserves dependency direction, three kinds, and isolated source files', () => {
  const g = translateXref(raw, '/project');
  assert.equal(g.status, 'ready');
  assert.equal(g.nodes.length, 5);
  assert.deepEqual(g.edges.map(e => [e.source, e.target, e.kind]), [
    ['lib/caller.ex', 'lib/data.ex', 'export'], ['lib/caller.ex', 'lib/macro.ex', 'compile'], ['lib/caller.ex', 'lib/service.ex', 'runtime']
  ]);
  assert.ok(g.nodes.some(n => n.id === 'lib/isolated.ex' && n.group === 'lib'));
  assert.match(g.warnings.join(' '), /not observed/);
});

test('malformed, unsafe and empty compiler outputs never become credible ready graphs', () => {
  for (const value of [[], null, { '../escape.ex': {} }, { '/absolute.ex': {} }, { 'lib/a.ex': [] }, { 'lib/a.ex': { 'lib/b.ex': 'unknown' } }]) {
    assert.throws(() => translateXref(value, '/project'));
  }
  assert.equal(translateXref({}, '/project').status, 'unavailable');
});

test('collector uses bounded no-shell no-compile Mix invocation and surfaces absent source files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'codeflow-beam-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let invoked = false;
  assert.equal((await collectBeamGraph(root, { execute: () => { invoked = true; } })).status, 'unavailable');
  assert.equal(invoked, false);
  await writeFile(path.join(root, 'mix.exs'), '');
  const graph = await collectBeamGraph(root, { execute: async (command, args, opts) => {
    assert.equal(command, 'mix');
    assert.deepEqual(args, ['xref', 'graph', '--format', 'json', '--output', '-', '--no-compile', '--no-deps-check']);
    assert.equal(opts.cwd, root);
    assert.equal(opts.shell, undefined);
    assert.equal(opts.timeout, 30000);
    assert.equal(opts.maxBuffer, 16 * 1024 * 1024);
    return { stdout: JSON.stringify(raw), stderr: 'sample diagnostic' };
  } });
  assert.equal(graph.status, 'ready');
  assert.equal(graph.producer.freshness, 'unverified');
  assert.ok(graph.nodes.every(n => n.sourceMissing));
  assert.match(graph.warnings.join(' '), /missing source files/);
  for (const failure of ['timeout', 'maxBuffer exceeded', 'Mix not installed']) {
    const result = await collectBeamGraph(root, { execute: async () => { throw new Error(failure); } });
    assert.equal(result.status, 'unavailable');
    assert.match(result.warnings.join(' '), new RegExp(failure));
  }
  assert.equal((await collectBeamGraph(root, { execute: async () => ({ stdout: 'not json' }) })).status, 'unavailable');
});

test('beam CLI flag opts in and endpoint serves the collected snapshot without execution', async t => {
  assert.deepEqual(parseCliArgs(['node', 'codeflow', '/project', '--beam']), { port: 4173, target: '/project', beam: true });
  const root = await mkdtemp(path.join(tmpdir(), 'codeflow-beam-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const beamGraph of [undefined, translateXref(raw, root)]) {
    const app = createCodeflowServer({ uiRoot: root, watchRoot: root, beamGraph });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${app.server.address().port}/__codeflow/beam`;
      const first = await (await fetch(url)).json();
      assert.equal(first.status, beamGraph ? 'ready' : 'unavailable');
      assert.deepEqual(await (await fetch(url)).json(), first);
    } finally { await app.close(); }
  }
});

// Real compiler semantics: macros, imported functions, structs, aliases, and an
// unreferenced file. The fixture has no dependencies and never starts an app.
test('real Mix compiler distinguishes macro, export and aliased runtime references', { skip: !process.env.CODEFLOW_TEST_MIX }, async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdir } = await import('node:fs/promises');
  const run = promisify(execFile);
  const root = await mkdtemp(path.join(tmpdir(), 'codeflow-real-mix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'lib'));
  await writeFile(path.join(root, 'mix.exs'), `defmodule Fixture.MixProject do
    use Mix.Project
    def project, do: [app: :codeflow_fixture, version: "0.1.0", elixir: ">= 1.19.0"]
  end`);
  const files = {
    'macros.ex': 'defmodule Fixture.Macros do\n defmacro value, do: quote(do: 1)\nend',
    'data.ex': 'defmodule Fixture.Data do\n defstruct [:value]\nend',
    'service.ex': 'defmodule Fixture.Service do\n def value, do: 1\nend',
    'caller.ex': `defmodule Fixture.Caller do
      require Fixture.Macros
      alias Fixture.Service, as: S
      def macro_value, do: Fixture.Macros.value()
      def data, do: %Fixture.Data{}
      def value, do: S.value()
    end`,
    'isolated.ex': 'defmodule Fixture.Isolated do\n def value, do: :unused\nend'
  };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, 'lib', name), content);
  await run('mix', ['compile'], { cwd: root, timeout: 30000 });
  const g = await collectBeamGraph(root);
  assert.equal(g.status, 'ready', g.warnings.join('\n'));
  assert.equal(g.nodes.length, 5);
  assert.deepEqual(g.edges.map(e => [e.source, e.target, e.kind]), [
    ['lib/caller.ex', 'lib/data.ex', 'export'], ['lib/caller.ex', 'lib/macros.ex', 'compile'], ['lib/caller.ex', 'lib/service.ex', 'runtime']
  ]);
  assert.ok(g.nodes.every(n => n.sourceModifiedAt && !n.sourceMissing));
  await writeFile(path.join(root, 'lib', 'caller.ex'), 'invalid source: collector must never compile it');
  const stale = await collectBeamGraph(root);
  assert.equal(stale.status, 'ready');
  assert.deepEqual(stale.edges, g.edges);
  assert.equal(stale.producer.freshness, 'unverified');
});
