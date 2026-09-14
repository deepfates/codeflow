import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const vendorRoot = join(repoRoot, 'vendor');
const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(join(vendorRoot, 'manifest.json'), 'utf8'));

test('browser runtime dependencies are local', async () => {
  const scriptSources = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), (match) => match[1]);
  const stylesheetSources = Array.from(html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi), (match) => match[1]);

  assert.ok(scriptSources.includes('./dist/app.js'));
  for(const source of scriptSources)await readFile(join(repoRoot,source));
  assert.equal(scriptSources.every((source) => source.startsWith('./vendor/')||source.startsWith('./dist/')), true);
  assert.equal(stylesheetSources.some((source) => /^https?:/i.test(source)), false);
  assert.doesNotMatch(html, /importScripts\(\\?["']https?:\/\//i);
  assert.doesNotMatch(html, /treeSitterWasmBase\s*:\s*["']https?:\/\//i);
});

test('vendored asset hashes match the recorded manifest', async () => {
  assert.equal(manifest.version, 1);
  async function assetPaths(directory, prefix = '') {
    const paths = [];
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      if (!prefix && ['licenses', 'manifest.json', 'THIRD_PARTY_NOTICES.md'].includes(entry.name)) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) paths.push(...await assetPaths(join(directory, entry.name), path + '/'));
      else paths.push(path);
    }
    return paths;
  }
  assert.deepEqual(manifest.assets.map(asset => asset.file).sort(), (await assetPaths(vendorRoot)).sort(),
    'the manifest covers every shipped asset exactly once');

  for (const asset of manifest.assets) {
    const bytes = await readFile(join(vendorRoot, asset.file));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, asset.sha256, asset.file);
  }
});

test('every vendored package has a checked-in license', async () => {
  const packageNames = new Set(manifest.assets.map((asset) => asset.package));
  const notices = await readFile(join(vendorRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

  for (const packageName of packageNames) {
    assert.match(notices, new RegExp('`' + packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`'));
  }
});
