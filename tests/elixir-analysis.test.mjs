import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCredo, parseCredoOutput, createElixirSession, ensureElixirLS } from '../cli/elixir-analysis.mjs';
const fixture = fileURLToPath(new URL('./fixtures/elixir-ls-server.mjs', import.meta.url));
const issue = { filename: 'lib/foo.ex', line_no: 8, column: 3, column_end: 6, message: 'Use Enum.map_join/3', check: 'Credo.Check.Refactor.MapJoin', category: 'refactor', priority: 13 };
test('Credo preserves exact locations, configured findings and category exit codes after cold-build output', async () => {
  const result = await collectCredo(os.tmpdir(), { execute: async (command, args) => {
    assert.equal(command, 'mix'); assert.deepEqual(args, ['credo', '--format', 'json']);
    throw Object.assign(new Error('findings'), { code: 4, stdout: '==> dependency\nCompiling 3 files\n' + JSON.stringify({ issues: [issue] }) });
  } });
  assert.equal(result.status, 'ready'); assert.equal(result.findings[0].path, 'lib/foo.ex');
  assert.deepEqual(result.findings[0].range, { start: { line: 7, character: 2 }, end: { line: 7, character: 5 } });
  assert.equal(result.findings[0].check, issue.check);
});
test('Credo failures cannot masquerade as an empty clean report', async () => {
  for (const error of [new Error('missing mix'), { code: 1, stdout: 'could not find task credo' }, { code: 1, killed: true, stdout: '{"issues":[]}' }, { code: 32, stdout: '{"issues":[]}' }]) {
    assert.equal((await collectCredo(os.tmpdir(), { execute: async () => { throw error; } })).status, 'unavailable');
  }
  assert.throws(() => parseCredoOutput('debug {"issues":[]}'));
  assert.equal((await collectCredo(os.tmpdir(), { execute: async () => ({ stdout: JSON.stringify({ issues: [{ ...issue, filename: '../outside.ex' }] }) }) })).status, 'unavailable');
  assert.deepEqual((await collectCredo(os.tmpdir(), { execute: async () => ({ stdout: '{"issues":[]}' }) })).findings, []);
});
test('language server session speaks standard RPC, updates documents, binds locations, and times out', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-lsp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'fixture.ex'), 'defmodule Fixture do\nend\n');
  await fs.symlink('/etc/hosts', path.join(root, 'escape.ex'));
  const updates = [];
  const session = await createElixirSession(root, { command: process.execPath, args: [fixture], timeout: 1000, onUpdate: state => updates.push(state) });
  t.after(() => session.dispose());
  const symbols = await session.symbols('fixture.ex');
  assert.equal(symbols[0].children[0].name, 'run/1');
  assert.equal(session.status().build.state, 'ready');
  assert.equal(session.status().diagnostics[0].path, 'fixture.ex');
  assert.equal(session.status().diagnostics[0].message, 'unused variable x');
  await session.change('fixture.ex', 'defmodule Changed do\nend', { save: false });
  assert.match((await session.symbols('fixture.ex'))[0].detail, /Changed/);
  const position = { line: 0, character: 10 };
  assert.equal((await session.definition('fixture.ex', position))[0].path, 'fixture.ex');
  assert.deepEqual((await session.references('fixture.ex', position)).map(x => x.path), ['fixture.ex', null]);
  await assert.rejects(session.symbols('../outside.ex'), /relative/);
  await assert.rejects(session.symbols('escape.ex'), /outside/);
  await assert.rejects(session.definition('fixture.ex', { line: -1, character: 0 }), /position/);
  await assert.rejects(session.workspaceSymbols('timeout'), /timed out/);
  await session.dispose(); assert.equal(session.status().state, 'closed');
  assert.ok(updates.length > 2);
});
test('ElixirLS installer rejects altered release bytes before extraction', async t => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-release-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  await assert.rejects(ensureElixirLS({ cacheRoot, fetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('wrong') }) }), /checksum/);
  assert.deepEqual(await fs.readdir(cacheRoot), []);
});
test('actual ElixirLS resolves a real project source definition', { skip: !process.env.CODEFLOW_TEST_ELIXIR_LS || !process.env.CODEFLOW_TEST_ELIXIR_PROJECT }, async t => {
  const session = await createElixirSession(process.env.CODEFLOW_TEST_ELIXIR_PROJECT, { command: process.env.CODEFLOW_TEST_ELIXIR_LS, environment: 'test', env: { ERL_FLAGS: '+S 4:4' } });
  t.after(() => session.dispose());
  const file = 'lib/grue/session.ex';
  const text = await fs.readFile(path.join(session.root, file), 'utf8');
  const rows = text.split('\n'); const line = rows.findIndex(x => x.includes('Grue.Exec.start_driver'));
  assert.ok(line >= 0);
  const symbols = await session.symbols(file); assert.ok(symbols.some(x => x.name.includes('Grue.Session')));
  const definitions = await session.definition(file, { line, character: rows[line].indexOf('start_driver') + 2 });
  assert.equal(definitions[0].path, 'lib/grue/exec.ex');
  assert.equal(definitions[0].range.start.line, 39);
});
