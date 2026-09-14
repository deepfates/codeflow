// ElixirLS owns parsing, indexing and compiler diagnostics. Codeflow owns its
// local process lifetime and maps standard LSP locations into the project.
import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, CancellationTokenSource } from 'vscode-jsonrpc/node';

const execute = promisify(execFile);
export const ELIXIR_LS_VERSION = '0.31.1';
const releaseURL = `https://github.com/elixir-lsp/elixir-ls/releases/download/v${ELIXIR_LS_VERSION}/elixir-ls-v${ELIXIR_LS_VERSION}.zip`;
const releaseSHA256 = 'bac08322ea3698157eb2373bb5b65e38c15df9dd41e1c06f142f874367fa472f';
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

export async function ensureElixirLS({ command = process.env.CODEFLOW_ELIXIR_LS, cacheRoot = path.join(os.homedir(), '.cache', 'codeflow'), fetch: fetcher = globalThis.fetch } = {}) {
  if (command) return command;
  const destination = path.join(cacheRoot, `elixir-ls-${ELIXIR_LS_VERSION}`);
  const launcher = path.join(destination, 'language_server.sh');
  try { await fs.access(launcher); return launcher; } catch {}
  if (process.platform === 'win32') throw new Error('Set CODEFLOW_ELIXIR_LS to an installed ElixirLS launcher on Windows.');
  await fs.mkdir(cacheRoot, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(cacheRoot, '.elixir-ls-'));
  try {
    const response = await fetcher(releaseURL, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`ElixirLS download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== releaseSHA256) throw new Error('ElixirLS release checksum does not match');
    const archive = path.join(temporary, 'release.zip');
    const extracted = path.join(temporary, 'server');
    await fs.writeFile(archive, bytes);
    await execute('unzip', ['-q', archive, '-d', extracted], { timeout: 30000 });
    await fs.chmod(path.join(extracted, 'language_server.sh'), 0o755);
    try { await fs.rename(extracted, destination); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; await fs.access(launcher); }
    return launcher;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

export function projectLocation(root, location) {
  const uri = location.uri || location.targetUri;
  let relative = null;
  try { const absolute = fileURLToPath(uri); if (inside(root, absolute)) relative = path.relative(root, absolute).split(path.sep).join('/'); } catch {}
  return { ...location, uri, range: location.range || location.targetSelectionRange || location.targetRange, path: relative };
}

export async function createElixirSession(projectRoot, options = {}) {
  const root = await fs.realpath(projectRoot);
  const command = await ensureElixirLS(options);
  const environment = options.environment || process.env.MIX_ENV || 'dev';
  const settings = { autoBuild: true, dialyzerEnabled: false, fetchDeps: false, mixEnv: environment, enableTestLenses: false, suggestSpecs: false };
  const child = spawn(command, options.args || [], { cwd: root, env: { ...process.env, ...options.env, MIX_ENV: environment }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  // Failed spawns have no usable pipes. Reject before JSON-RPC writes to them.
  await once(child, 'spawn');
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  let state = 'starting', reason = null, build = { state: 'pending' }, log = '', disposed = false, serverInfo = null;
  const diagnostics = new Map(), opened = new Map(), opening = new Map();
  const status = () => ({ state, reason, build, diagnostics: [...diagnostics.values()].flat(), producer: { name: 'ElixirLS', version: serverInfo?.version || null, environment }, log });
  const update = () => options.onUpdate?.(status());
  const kill = signal => { try { if (process.platform === 'win32') child.kill(signal); else if (child.pid) process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  child.stderr.on('data', bytes => { log = (log + bytes.toString()).slice(-8000); });
  child.on('error', error => { state = 'error'; reason = error.message; update(); connection.dispose(); });
  child.on('exit', (code, signal) => { if (!disposed) { state = 'error'; reason = `ElixirLS exited (${signal || code})`; update(); } connection.dispose(); });
  connection.onRequest('workspace/configuration', ({ items }) => items.map(() => settings));
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('window/workDoneProgress/create', () => null);
  connection.onNotification('textDocument/publishDiagnostics', event => {
    const location = projectLocation(root, { uri: event.uri });
    diagnostics.set(event.uri, event.diagnostics.map(item => ({ ...item, path: location.path, uri: event.uri, source: item.source || 'ElixirLS' })));
    // A failed build can exit before ElixirLS emits its build telemetry.
    // Published compiler errors must not leave the session indefinitely pending.
    if (event.diagnostics.some(item => item.severity === 1)) build = { state: 'error', result: 'compiler_diagnostics', completedAt: new Date().toISOString() };
    update();
  });
  connection.onNotification('telemetry/event', event => {
    if (event.name !== 'build') return;
    const result = event.properties?.['elixir_ls.build_result'];
    build = { state: ['mix_compile_ok', 'mix_compile_noop'].includes(result) ? 'ready' : 'error', result, completedAt: new Date().toISOString() };
    update();
  });
  connection.listen();
  async function request(method, params, timeout = options.timeout ?? 120000) {
    if (disposed || state === 'error') throw new Error(reason || 'ElixirLS session is closed');
    const cancellation = new CancellationTokenSource();
    let timer;
    try {
      return await Promise.race([connection.sendRequest(method, params, cancellation.token), new Promise((_, reject) => { timer = setTimeout(() => { cancellation.cancel(); reject(new Error(`ElixirLS ${method} timed out`)); }, timeout); })]);
    } finally { clearTimeout(timer); cancellation.dispose(); }
  }
  async function source(file) {
    if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\0') || file.split(/[\\/]/).includes('..')) throw new Error('Expected a project-relative source path');
    const absolute = await fs.realpath(path.join(root, file));
    if (!inside(root, absolute)) throw new Error('Source is outside the project');
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Source must be a file smaller than 2 MB');
    return { absolute, uri: pathToFileURL(absolute).href };
  }
  async function open(file) {
    const { absolute, uri } = await source(file);
    if (!opened.has(uri)) {
      if (!opening.has(uri)) opening.set(uri, (async () => {
        await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'elixir', version: 1, text: await fs.readFile(absolute, 'utf8') } });
        opened.set(uri, 1);
      })());
      try { await opening.get(uri); } finally { opening.delete(uri); }
    }
    return uri;
  }
  function positionParams(uri, position) {
    if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0) throw new Error('Expected a zero-based LSP position');
    return { textDocument: { uri }, position };
  }
  async function dispose() {
    if (disposed) return;
    try { if (state !== 'error') { await request('shutdown', null, 1500); await connection.sendNotification('exit'); } } catch {}
    disposed = true; state = 'closed'; connection.dispose(); kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 1500); timer.unref(); update();
  }
  try {
    const initialized = await request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: { workspace: { configuration: true }, textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } }, clientInfo: { name: 'Codeflow', version: '1.0.0' } }, options.initializeTimeout ?? 300000);
    serverInfo = initialized.serverInfo;
    await connection.sendNotification('initialized', {});
    await connection.sendNotification('workspace/didChangeConfiguration', { settings: { elixirLS: settings } });
    state = 'ready'; update();
  } catch (error) { await dispose(); throw error; }
  return {
    root, status, open, dispose,
    async change(file, text, { save = true } = {}) {
      const uri = await open(file);
      if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Source must be text smaller than 2 MB');
      const version = opened.get(uri) + 1; opened.set(uri, version);
      await connection.sendNotification('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
      if (save) { build = { state: 'pending' }; update(); await connection.sendNotification('textDocument/didSave', { textDocument: { uri } }); }
    },
    async symbols(file) { return await request('textDocument/documentSymbol', { textDocument: { uri: await open(file) } }) || []; },
    async workspaceSymbols(query) { if (typeof query !== 'string' || query.length > 500) throw new Error('Invalid symbol query'); return (await request('workspace/symbol', { query }) || []).map(item => ({ ...item, location: projectLocation(root, item.location) })); },
    async definition(file, position) { const result = await request('textDocument/definition', positionParams(await open(file), position)); return (Array.isArray(result) ? result : result ? [result] : []).map(item => projectLocation(root, item)); },
    async references(file, position) { return (await request('textDocument/references', { ...positionParams(await open(file), position), context: { includeDeclaration: true } }) || []).map(item => projectLocation(root, item)); }
  };
}

// Mix can write dependency compilation logs before Credo's JSON. Find a complete
// JSON payload, never infer success from a nonzero exit code or an empty stream.
export function parseCredoOutput(stdout) {
  for (const match of String(stdout).matchAll(/^\s*\{/gm)) {
    try { const result = JSON.parse(stdout.slice(match.index)); if (Array.isArray(result.issues)) return result; } catch {}
  }
  throw new Error('Credo did not return a JSON issues report');
}
export async function collectCredo(root, options = {}) {
  const runner = fileURLToPath(new URL('./credo.exs', import.meta.url));
  const producer = { name: 'Credo', command: ['elixir', runner, root], collectedAt: new Date().toISOString() };
  try {
    root = await fs.realpath(root);
    producer.command[2] = root;
    let output;
    try { output = await (options.execute || execute)('elixir', [runner, root], { cwd: root, env: { ...process.env, MIX_ENV: options.environment || process.env.MIX_ENV || 'dev' }, timeout: options.timeout ?? 180000, maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL' }); }
    catch (error) {
      // Credo returns a category bitmask (1..31) when configured checks find
      // issues. Spawn errors, signals and timeouts are execution failures.
      if (error.killed || error.signal || !Number.isInteger(error.code) || error.code < 1 || error.code > 31) throw error;
      output = error;
    }
    let report;
    try { report = parseCredoOutput(output.stdout); }
    catch (error) { throw Object.assign(error, { stderr: output.stderr || output.stdout }); }
    const findings = [];
    for (const issue of report.issues) {
      if (typeof issue.filename !== 'string' || typeof issue.message !== 'string') throw new Error('Credo returned an invalid issue');
      const absolute = path.resolve(root, issue.filename);
      if (!inside(root, absolute)) throw new Error('Credo returned an out-of-project source path');
      const line = Number.isInteger(issue.line_no) && issue.line_no > 0 ? issue.line_no - 1 : null;
      const character = Number.isInteger(issue.column) && issue.column > 0 ? issue.column - 1 : 0;
      findings.push({ ...issue, path: path.relative(root, absolute).split(path.sep).join('/'), source: 'Credo', range: line === null ? null : { start: { line, character }, end: { line, character: Number.isInteger(issue.column_end) ? Math.max(character, issue.column_end - 1) : character } } });
    }
    return { status: 'ready', findings, producer };
  } catch (error) { return { status: 'unavailable', findings: [], reason: String(error.stderr || error.message || error).trim().slice(0, 4000), producer }; }
}
