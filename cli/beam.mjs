// Mix owns Elixir dependency semantics. This adapter only translates its JSON graph.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const XREF_ARGS = ['xref', 'graph', '--format', 'json', '--output', '-', '--no-compile', '--no-deps-check'];
const warnings = [
  'Snapshot of existing compiler manifests: sources may have changed since compilation. Restart Codeflow after compiling to collect a new snapshot.',
  'Dependency freshness is not checked (--no-deps-check); no compilation, dependency fetching, or application startup is requested.',
  'Runtime edges are compiler-recorded references, not observed messages or running processes. Dynamic calls, uncompiled files, and external dependency internals are not represented.'
];

export function unavailableBeam(root, reason, environment = process.env.MIX_ENV || 'dev') {
  return { schemaVersion: 1, status: 'unavailable', project: { name: path.basename(root), root, environment },
    producer: { name: 'mix xref', command: ['mix', ...XREF_ARGS], minimumElixir: '1.19' },
    nodes: [], edges: [], warnings: [reason, ...warnings] };
}

function sourcePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || value.split('/').some(p => p === '..' || p === '.' || p === '')) {
    throw new Error('Mix returned an unsafe or non-relative source path');
  }
  return value;
}

export function translateXref(raw, root, environment = 'dev') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected Mix xref JSON map');
  const paths = new Set();
  const edges = [];
  for (const [source, deps] of Object.entries(raw)) {
    paths.add(sourcePath(source));
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) throw new Error('Expected dependency map for ' + source);
    for (const [target, kind] of Object.entries(deps)) {
      paths.add(sourcePath(target));
      if (!['compile', 'export', 'runtime'].includes(kind)) throw new Error('Unknown Mix dependency kind: ' + kind);
      edges.push({ id: JSON.stringify([source, target, kind]), source, target, kind });
    }
  }
  if (!paths.size) return unavailableBeam(root, 'No compiled source graph found. Compile this trusted project with Mix first, then restart Codeflow.', environment);
  return { ...unavailableBeam(root, '', environment), status: 'ready',
    nodes: [...paths].sort().map(p => ({ id: p, path: p, label: path.posix.basename(p), group: path.posix.dirname(p) })),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)), warnings: [...warnings] };
}

export async function collectBeamGraph(root, options = {}) {
  root = path.resolve(root);
  const environment = options.environment || process.env.MIX_ENV || 'dev';
  try {
    if (!(await fs.stat(path.join(root, 'mix.exs'))).isFile()) throw new Error('mix.exs is not a file');
  } catch {
    return unavailableBeam(root, 'Select a local Mix project directory containing mix.exs.', environment);
  }
  try {
    const run = options.execute || execute;
    const { stdout, stderr } = await run('mix', XREF_ARGS, {
      cwd: root, env: { ...process.env, MIX_ENV: environment, MIX_QUIET: '1' },
      timeout: options.timeout ?? 30000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      killSignal: 'SIGKILL', windowsHide: true
    });
    const graph = translateXref(JSON.parse(stdout), root, environment);
    graph.producer.collectedAt = new Date().toISOString();
    // Mix allows custom build paths. Do not guess freshness from a timestamp:
    // these source mtimes are evidence for inspection, not proof of a matching build.
    const missing = [];
    await Promise.all(graph.nodes.map(async node => {
      try { node.sourceModifiedAt = (await fs.stat(path.join(root, node.path))).mtime.toISOString(); }
      catch { node.sourceMissing = true; missing.push(node.path); }
    }));
    if (missing.length) graph.warnings.push('Compiler graph references missing source files: ' + missing.sort().join(', '));
    graph.producer.freshness = 'unverified';
    if (stderr?.trim()) graph.warnings.push('Mix diagnostic: ' + stderr.trim().slice(0, 4000));
    return graph;
  } catch (error) {
    const diagnostic = String(error.stderr || error.message || error).trim().slice(0, 4000);
    return unavailableBeam(root, 'Could not read compiler graph. Requires Elixir 1.19+ and existing Mix compilation artifacts. ' + diagnostic, environment);
  }
}
