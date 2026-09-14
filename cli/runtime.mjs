import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL('./runtime.exs', import.meta.url));
export function unavailableRuntime(node, reason) {
  return { schemaVersion: 1, status: 'unavailable', node: node || null, collectedAt: new Date().toISOString(), applications: [], processes: [], truncated: false, warnings: [reason] };
}

export async function collectRuntimeSnapshot(root, options = {}) {
  const node = options.node;
  if (!node) return unavailableRuntime(null, 'Connect a local named BEAM node to explore running processes.');
  const match = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)$/.exec(node);
  const localHosts = new Set(['localhost', '127.0.0.1', os.hostname(), os.hostname().split('.')[0]]);
  if (!match || !localHosts.has(match[2])) return unavailableRuntime(node, 'Use a node name on this machine (name@hostname).');
  const names = options.nameType || (match[2].includes('.') ? 'longnames' : 'shortnames');
  if (!['longnames', 'shortnames'].includes(names)) return unavailableRuntime(node, 'Node name type must be shortnames or longnames.');
  const limit = Math.max(1, Math.min(10000, Number(options.maxProcesses) || 2000));
  const depth = Math.max(1, Math.min(100, Number(options.maxDepth) || 20));
  try {
    const env = { ...process.env, CODEFLOW_RUNTIME_NODE: node, CODEFLOW_RUNTIME_NAMES: names,
      CODEFLOW_RUNTIME_LIMIT: String(Math.floor(limit)), CODEFLOW_RUNTIME_DEPTH: String(Math.floor(depth)) };
    const cookie = options.cookie ?? process.env.CODEFLOW_BEAM_COOKIE;
    delete env.CODEFLOW_RUNTIME_COOKIE;
    if (cookie) env.CODEFLOW_RUNTIME_COOKIE = cookie;
    const { stdout } = await (options.execute || execute)('elixir', [helper], {
      cwd: root, env, timeout: options.timeout ?? 15000, maxBuffer: 8 * 1024 * 1024,
      killSignal: 'SIGKILL', windowsHide: true
    });
    const line = stdout.split('\n').find(line => line.startsWith('CODEFLOW_RUNTIME:'));
    const raw = JSON.parse(line?.slice('CODEFLOW_RUNTIME:'.length));
    if (!Array.isArray(raw.applications) || !Array.isArray(raw.processes)) throw new Error('Invalid runtime response');
    const canonicalRoot = await fs.realpath(root);
    for (const process of raw.processes) {
      process.sourcePath = null;
      // Compile metadata from a release may refer to another checkout. Never guess.
      if (typeof process.source === 'string' && path.isAbsolute(process.source)) {
        try {
          const source = await fs.realpath(process.source);
          const relative = path.relative(canonicalRoot, source);
          if (relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) && (await fs.stat(source)).isFile()) process.sourcePath = relative.split(path.sep).join('/');
        } catch { /* Source unavailable in this checkout. */ }
      }
      delete process.source;
    }
    return { schemaVersion: 1, status: 'ready', node, collectedAt: new Date().toISOString(), ...raw,
      warnings: [
        ...(raw.processInventoryStatus === 'unavailable' ? ['The process inventory could not be queried; only observed application trees are shown.'] : []),
        ...(raw.truncated ? ['The runtime snapshot reached its process or depth limit.'] : []),
        ...raw.processes.filter(p => p.observationStatus === 'unavailable').map(p => `Process information unavailable for ${p.pid || p.id}; liveness is unknown.`),
        ...(raw.processes.some(p => p.childrenStatus === 'unavailable') ? ['Some supervisors did not respond during this snapshot.'] : [])
      ] };
  } catch {
    // Distribution stderr may contain configuration details: never return it or cookie values.
    return unavailableRuntime(node, 'Could not inspect this node. Check that it is running locally, its name and cookie match, and Elixir 1.19+ is available.');
  }
}
