// Acquire source records. The shared engine owns language preparation,
// definitions and project assembly.

'use strict';

const fs = require('fs');
const path = require('path');

const { matchesExcludePattern } = require('../../src/project/exclusion-policy.cjs');

const {IGNORE:DEFAULT_IGNORES}=require('../../src/project/exclusion-policy.cjs');

function walk(root, current, files, Parser, excludePatterns) {
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.git')) continue;
    if (DEFAULT_IGNORES.has(entry.name.toLowerCase())) continue;
    const full = path.join(current, entry.name);
    const repoPath = path.relative(root, full).split(path.sep).join('/');
    // Prune excluded paths during the walk — exclusion must happen before
    // the analysis engine sees the files, or huge vendored
    // trees (minified bundles, absorbed third-party code) blow the analysis
    // phase up from seconds to hours.
    if (matchesExcludePattern(excludePatterns, repoPath, entry.name)) continue;
    if (entry.isDirectory()) {
      walk(root, full, files, Parser, excludePatterns);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!Parser.isIncluded(entry.name)) continue;
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      // A racing filesystem change will be handled by the read step.
    }
    files.push({
      fullPath: full,
      path: repoPath,
      name: path.basename(repoPath),
      folder: repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : 'root',
      size,
    });
  }
}

async function collectFiles(repoRoot, Parser, excludePatterns) {
  const files = [];
  walk(repoRoot, repoRoot, files, Parser, excludePatterns || []);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const analyzed = [];
  for (const file of files) {
    if (Parser.isOversized(file.size)) {
      analyzed.push({path:file.path,name:file.name,folder:file.folder,size:file.size,analysisSkipped:'oversized'});
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(file.fullPath, 'utf8');
    } catch {
      analyzed.push({path:file.path,name:file.name,folder:file.folder,analysisSkipped:'fetch-failed'});
      continue;
    }
    analyzed.push({path:file.path,name:file.name,folder:file.folder,content,size:file.size});
  }
  return analyzed;
}

module.exports = { collectFiles };
