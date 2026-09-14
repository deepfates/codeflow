import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { collectRuntimeSnapshot } from '../cli/runtime.mjs';

test('runtime stays unavailable without a local node and does not expose credentials', async () => {
  assert.equal((await collectRuntimeSnapshot('.', {})).status, 'unavailable');
  const remote = await collectRuntimeSnapshot('.', { node: 'app@some-remote-server', execute: () => assert.fail('must not connect') });
  assert.equal(remote.status, 'unavailable');
  const failed = await collectRuntimeSnapshot('.', { node: `app@${hostname().split('.')[0]}`, cookie: 'secret-cookie', execute: async () => { throw new Error('secret-cookie'); } });
  assert.equal(failed.status, 'unavailable');
  assert.ok(!JSON.stringify(failed).includes('secret-cookie'));
});

test('runtime maps only existing checkout source and puts cookie in environment, not arguments', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codeflow-runtime-'));
  try {
    await writeFile(path.join(root, 'worker.ex'), 'defmodule Worker do\nend\n');
    const result = await collectRuntimeSnapshot(root, { node: `test@${hostname().split('.')[0]}`, cookie: 'test-cookie', execute: async (cmd, args, options) => {
      assert.equal(cmd, 'elixir');
      assert.ok(!args.join(' ').includes('test-cookie'));
      assert.equal(options.env.CODEFLOW_RUNTIME_COOKIE, 'test-cookie');
      return { stdout: 'CODEFLOW_RUNTIME:' + JSON.stringify({ applications: [], processes: [{ id: 'one', source: path.join(root, 'worker.ex') }, { id: 'two', source: '/etc/hosts' }], truncated: false }) };
    }});
    assert.equal(result.processes[0].sourcePath, 'worker.ex');
    assert.equal(result.processes[1].sourcePath, null);
    assert.ok(!JSON.stringify(result).includes('/etc/hosts'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real OTP node exposes actual supervisor children, metrics and source', { skip: !process.env.CODEFLOW_TEST_MIX }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codeflow-runtime-live-'));
  const node = `codeflow_test_${process.pid}@${hostname().split('.')[0]}`;
  const cookie = 'codeflow_disposable_test';
  const source = path.join(root, 'runtime.exs');
  await writeFile(source, `defmodule CodeflowFixture.Worker do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  def init(_), do: {:ok, nil}
end
defmodule CodeflowFixture.Application do
  use Application
  def start(_, _), do: Supervisor.start_link([CodeflowFixture.Worker], strategy: :one_for_one, name: CodeflowFixture.Supervisor)
end
:application.load({:application, :codeflow_fixture, [{:description, ~c"Fixture"}, {:vsn, ~c"1"}, {:modules, [CodeflowFixture.Application, CodeflowFixture.Worker]}, {:registered, []}, {:applications, [:kernel, :stdlib, :elixir]}, {:mod, {CodeflowFixture.Application, []}}]})
:ok = Application.start(:codeflow_fixture)
IO.puts("READY")
Process.sleep(:infinity)
`);
  const child = spawn('elixir', ['--sname', node, '--cookie', cookie, source], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('node did not start: ' + output)), 15000);
      child.stdout.on('data', data => { output += data; if (output.includes('READY')) { clearTimeout(timeout); resolve(); } });
      child.stderr.on('data', data => { output += data; });
      child.on('exit', code => { clearTimeout(timeout); reject(new Error('node exited ' + code + ': ' + output)); });
    });
    const snapshot = await collectRuntimeSnapshot(root, { node, cookie });
    assert.equal(snapshot.status, 'ready', JSON.stringify(snapshot));
    const app = snapshot.applications.find(app => app.name === 'codeflow_fixture');
    assert.ok(app.rootId);
    const worker = snapshot.processes.find(p => p.module === 'Elixir.CodeflowFixture.Worker');
    assert.ok(worker);
    assert.equal(worker.parentId, app.rootId);
    assert.equal(worker.sourcePath, 'runtime.exs');
    assert.ok(worker.metrics.memory > 0);
    assert.ok(snapshot.processes.find(p => p.id === app.rootId).children.includes(worker.id));
    const failed = await collectRuntimeSnapshot(root, { node, cookie: 'wrong' });
    assert.equal(failed.status, 'unavailable');
    const bounded = await collectRuntimeSnapshot(root, { node, cookie, maxProcesses: 2 });
    assert.equal(bounded.status, 'ready');
    assert.equal(bounded.processes.length, 2);
    assert.equal(bounded.truncated, true);
  } finally { child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }); }
});

test('real process-info distinguishes live, exited and unavailable observations', {skip: !process.env.CODEFLOW_TEST_MIX}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codeflow-runtime-observation-'));
  try {
    const script = path.join(root, 'observe.exs');
    await writeFile(script, `Code.require_file(System.fetch_env!("CODEFLOW_RUNTIME_MODULE"))
live = spawn(fn -> Process.sleep(:infinity) end)
dead = spawn(fn -> :ok end)
monitor = Process.monitor(dead)
receive do {:DOWN, ^monitor, :process, ^dead, _} -> :ok end
state = %{processes: %{}, sources: %{Codeflow.Runtime => System.fetch_env!("CODEFLOW_RUNTIME_MODULE")}, truncated: false}
observe = fn target, pid ->
  Codeflow.Runtime.walk(target, pid, nil, nil, :process, [Codeflow.Runtime], 0, state, 10, 5).processes[inspect(pid)]
end
ready = observe.(node(), live)
exited = observe.(node(), dead)
unavailable = observe.(:codeflow_missing@localhost, live)
{inventory_status, inventory} = Codeflow.Runtime.process_inventory(node())
{failed_status, failed_inventory} = Codeflow.Runtime.process_inventory(:codeflow_missing@localhost)
IO.puts(JSON.encode!(%{ready: ready, exited: exited, unavailable: unavailable, stillAlive: Process.alive?(live), inventoryStatus: inventory_status, hasLiveProcess: live in inventory, failedInventoryStatus: failed_status, failedInventory: failed_inventory}))
Process.exit(live, :kill)
`);
    const modulePath = fileURLToPath(new URL('../cli/runtime.ex', import.meta.url));
    const {stdout} = await promisify(execFile)('elixir', [script], {env: {...process.env, CODEFLOW_RUNTIME_MODULE: modulePath}});
    const observed = JSON.parse(stdout.trim());
    assert.equal(observed.inventoryStatus, 'ready');
    assert.equal(observed.hasLiveProcess, true);
    assert.equal(observed.failedInventoryStatus, 'unavailable');
    assert.deepEqual(observed.failedInventory, []);
    assert.equal(observed.stillAlive, true, 'failed RPC did not establish that the real process exited');
    assert.equal(observed.unavailable.metrics.status, 'unavailable');
    assert.equal(observed.unavailable.observationStatus, 'unavailable');
    assert.equal(observed.exited.metrics.status, 'exited');
    assert.equal(observed.exited.observationStatus, 'exited');
    assert.equal(observed.ready.observationStatus, 'ready');
    assert.ok(observed.ready.metrics.memory > 0);
    assert.equal(observed.unavailable.source, modulePath, 'previously observed module source survives unavailable process metrics');
    const snapshot = await collectRuntimeSnapshot(path.dirname(modulePath), {
      node: `test@${hostname().split('.')[0]}`,
      execute: async () => ({stdout: 'CODEFLOW_RUNTIME:' + JSON.stringify({applications: [], processes: [observed.ready, observed.exited, observed.unavailable], processInventoryStatus: observed.failedInventoryStatus, truncated: false})}),
    });
    assert.equal(snapshot.processes.length, 3, 'inventory failure preserves observed application processes');
    assert.equal(snapshot.processes[2].sourcePath, 'runtime.ex');
    assert.ok(snapshot.warnings.some(warning => warning.includes('process inventory')));
    assert.ok(snapshot.warnings.some(warning => warning.includes(observed.unavailable.pid) && warning.includes('unknown')));
    assert.ok(!snapshot.warnings.some(warning => warning.includes(observed.exited.pid)), 'confirmed exit is not an observation failure');
  } finally { await rm(root, {recursive: true, force: true}); }
});
