import {calcBlast} from './metrics.mjs';

function calcPRRisk(prData, repoData) {
    if (!prData || !repoData) return { score: 0, level: 'low', factors: [] };
    var score = 0;
    var factors = [];
    var changedFiles = prData.files || [];
    var totalBlast = 0;
    var hotspots = [];
    changedFiles.forEach(function(f) {
        var existing = repoData.files.find(function(df) { return df.path === f.filename; });
        if (existing) {
            var blast = calcBlast(f.filename, repoData.connections, repoData.files);
            totalBlast += blast.count;
            if (blast.count > 5) hotspots.push({ file: f.filename, blast: blast.count });
        }
    });
    if (totalBlast > 50) { score += 30; factors.push('High blast radius (' + totalBlast + ' files)'); }
    else if (totalBlast > 20) { score += 15; factors.push('Moderate blast radius'); }
    if (changedFiles.length > 10) { score += 20; factors.push('Many files changed (' + changedFiles.length + ')'); }
    else if (changedFiles.length > 5) { score += 10; factors.push('Several files changed'); }
    var totalChanges = (prData.additions || 0) + (prData.deletions || 0);
    if (totalChanges > 500) { score += 25; factors.push('Large changeset (' + totalChanges + ' lines)'); }
    else if (totalChanges > 200) { score += 12; factors.push('Moderate changeset'); }
    var coreFiles = changedFiles.filter(function(f) { return f.filename.includes('/core/') || f.filename.includes('/utils/') || f.filename.includes('/lib/'); });
    if (coreFiles.length > 0) { score += 15; factors.push('Core files modified (' + coreFiles.length + ')'); }
    var configFiles = changedFiles.filter(function(f) { return f.filename.match(/\.(json|yaml|yml|toml|env)$/); });
    if (configFiles.length > 0) { score += 10; factors.push('Config files changed'); }
    score = Math.min(100, score);
    var level = score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
    return { score: score, level: level, factors: factors, totalBlast: totalBlast, hotspots: hotspots.sort(function(a,b){ return b.blast - a.blast; }).slice(0, 5) };
}

function findReviewAreas(prData, repoData) {
    if (!prData || !repoData) return [];
    var changedPaths = (prData.files || []).map(function(f) { return f.filename; });
    var areas = new Map();
    repoData.files.forEach(function(f) {
        // Folder membership is a path segment boundary, not a sibling name prefix.
        if (!f.folder || !changedPaths.some(function(p) { return p.startsWith(f.folder + '/'); })) return;
        var layer = f.layer || 'other';
        if (!areas.has(layer)) areas.set(layer, { layer: layer, count: 0, files: [] });
        var area = areas.get(layer);
        area.count++;
        area.files.push(f.path);
    });
    return Array.from(areas.values()).sort(function(a,b) { return b.count - a.count; }).slice(0,3);
}

function findTestImpact(prData, repoData) {
    if (!prData || !repoData) return [];
    var changedFiles = (prData.files || []).map(function(f) { return f.filename; });
    var testFiles = repoData.files.filter(function(f) { return f.name.match(/\.test\.|\.spec\.|_test\.|test_/i); });
    var impacted = [];
    testFiles.forEach(function(tf) {
        var shouldRun = changedFiles.some(function(cf) {
            var cfBase = cf.replace(/\.[^.]+$/, '').split('/').pop();
            return tf.name.toLowerCase().includes(cfBase.toLowerCase());
        });
        if (shouldRun) impacted.push({ file: tf.name, path: tf.path });
    });
    if (impacted.length === 0 && testFiles.length > 0) {
        impacted = testFiles.slice(0, 3).map(function(tf) { return { file: tf.name, path: tf.path, suggested: true }; });
    }
    return impacted;
}

function findDependencyChains(prData, repoData) {
    if (!prData || !repoData) return [];
    var changedFiles = (prData.files || []).map(function(f) { return f.filename; });
    var chains = [];
    changedFiles.slice(0, 3).forEach(function(file) {
        var chain = [file.split('/').pop()];
        var visited = new Set([file]);
        var queue = [file];
        var depth = 0;
        while (queue.length > 0 && depth < 3) {
            var current = queue.shift();
            repoData.connections.forEach(function(c) {
                var src = typeof c.source === 'object' ? c.source.id : c.source;
                var tgt = typeof c.target === 'object' ? c.target.id : c.target;
                if (tgt === current && !visited.has(src)) {
                    visited.add(src);
                    chain.push(src.split('/').pop());
                    queue.push(src);
                }
            });
            depth++;
        }
        if (chain.length > 1) chains.push(chain.slice(0, 5));
    });
    return chains;
}

export {calcPRRisk,findReviewAreas,findTestImpact,findDependencyChains};
